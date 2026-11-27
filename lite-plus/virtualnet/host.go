package virtualnet

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const HostFileLimit = 8 << 20

type HostRequest struct {
	Operation string `json:"operation"`
	Command   string `json:"command"`
	Path      string `json:"path"`
	Data      string `json:"data"`
	Project   string `json:"project"`
	Action    string `json:"action"`
}

// ConnectHost deliberately does not call run(): an interactive shell or SFTP
// session must NEVER inherit the deployment profile's automatic sudo behavior.
func ConnectHost(ctx context.Context, p Profile) (*ssh.Client, error) {
	c, _, err := connect(ctx, p, false)
	return c, err
}

type limitedOutput struct {
	sync.Mutex
	data      []byte
	truncated bool
}

func (b *limitedOutput) Write(p []byte) (int, error) {
	b.Lock()
	defer b.Unlock()
	n := len(p)
	remaining := (1 << 20) - len(b.data)
	if len(p) > remaining {
		b.truncated = true
		p = p[:remaining]
	}
	b.data = append(b.data, p...)
	return n, nil
}

func HostOperation(ctx context.Context, profile Profile, policy PolicyInput, request HostRequest) (any, error) {
	var command string
	sudo := false
	switch request.Operation {
	case "exec":
		if !policy.HostExec {
			return nil, errors.New("host command permission is disabled")
		}
		if strings.TrimSpace(request.Command) == "" || len(request.Command) > 64<<10 || strings.ContainsRune(request.Command, 0) {
			return nil, errors.New("invalid command")
		}
		command = request.Command
	case "docker":
		if request.Project == "enb-managed-node" {
			if !policy.NodeDocker {
				return nil, errors.New("managed Node Docker permission is disabled")
			}
			command = "set -eu\n" + loginDeploymentPaths + managedProjectGuard + `test -f "$enb_target/compose.yaml"
test ! -L "$enb_target/compose.yaml"
test ! -L "$enb_target/permissions.yaml"
test ! -L "$enb_target/node-version.yaml"
test ! -L "$enb_target/.env"
cd "$enb_target"
set -- -p enb-managed-node -f compose.yaml
if [ -f permissions.yaml ]; then set -- "$@" -f permissions.yaml; fi
if [ -f node-version.yaml ]; then set -- "$@" -f node-version.yaml; fi
test "$(docker compose "$@" config --services)" = node
docker compose "$@" `
			sudo = profile.Sudo // Only the explicit, fixed managed Compose operation.
		} else {
			var project *Project
			for i := range policy.Projects {
				if policy.Projects[i].Name == request.Project {
					project = &policy.Projects[i]
					break
				}
			}
			if project == nil {
				return nil, errors.New("Compose project is not authorized")
			}
			// Resolve every path component; do not accept symlink aliases.
			command = "set -eu\ntest \"$(cd -P " + quote(project.Directory) + " && pwd)\" = " + quote(project.Directory) + "\ncd " + quote(project.Directory) + "\ntest -f compose.yaml\ntest ! -L compose.yaml\ntest ! -L .env\n" +
				"for enb_id in $(docker ps -aq --filter label=com.docker.compose.project=" + quote(project.Name) + "); do\n" +
				"test \"$(docker inspect -f '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}' \"$enb_id\")\" = " + quote(project.Directory) + "\ndone\n" +
				"docker compose -p " + quote(project.Name) + " -f compose.yaml "
		}
		switch request.Action {
		case "status":
			command += "ps --all"
		case "logs":
			command += "logs --no-color --tail 200"
		case "restart":
			command += "restart"
		case "start":
			command += "start"
		case "stop":
			command += "stop"
		default:
			return nil, errors.New("unsupported Compose operation")
		}
	case "list", "download", "upload":
		if !policy.HostFiles {
			return nil, errors.New("host file permission is disabled")
		}
		return hostFiles(ctx, profile, request)
	default:
		return nil, errors.New("unsupported host operation")
	}
	c, err := ConnectHost(ctx, profile)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	watchDone := make(chan struct{})
	defer close(watchDone)
	go func() {
		select {
		case <-ctx.Done():
			c.Close()
		case <-watchDone:
		}
	}()
	// Fixed Compose operations can reuse explicitly configured deployment sudo,
	// but raw host commands never get a password or a privileged wrapper.
	if sudo {
		output := &limitedOutput{}
		err = runOutput(ctx, c, profile, command, "", output)
		code := 0
		if err != nil {
			var exit remoteExitError
			if !errors.As(err, &exit) {
				return nil, err
			}
			code = exit.code
		}
		return map[string]any{"output": string(output.data), "exit_code": code, "truncated": output.truncated}, nil
	}
	s, err := c.NewSession()
	if err != nil {
		return nil, errors.New("SSH session failed")
	}
	defer s.Close()
	output := &limitedOutput{}
	s.Stdout = output
	s.Stderr = output
	done := make(chan error, 1)
	go func() { done <- s.Run("sh -c " + quote(command) + " enb \"$HOME\"") }()
	select {
	case <-ctx.Done():
		c.Close()
		return nil, errors.New("host operation timed out; verify remote process state before retrying")
	case err = <-done:
	}
	code := 0
	if err != nil {
		var exit *ssh.ExitError
		if !errors.As(err, &exit) {
			return nil, errors.New("SSH operation failed")
		}
		code = exit.ExitStatus()
	}
	return map[string]any{"output": string(output.data), "exit_code": code, "truncated": output.truncated}, nil
}

func hostFiles(ctx context.Context, p Profile, r HostRequest) (any, error) {
	c, err := ConnectHost(ctx, p)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			c.Close()
		case <-done:
		}
	}()
	f, err := sftp.NewClient(c, sftp.MaxPacket(32<<10))
	if err != nil {
		return nil, errors.New("SFTP unavailable")
	}
	defer f.Close()
	if r.Path == "" {
		r.Path, err = f.Getwd()
		if err != nil {
			return nil, errors.New("SFTP home unavailable")
		}
	}
	if !path.IsAbs(r.Path) || strings.ContainsAny(r.Path, "\x00\r\n") || len(r.Path) > 4096 {
		return nil, errors.New("absolute file path required")
	}
	r.Path = path.Clean(r.Path)
	switch r.Operation {
	case "list":
		entries, err := f.ReadDirContext(ctx, r.Path)
		if err != nil {
			return nil, errors.New("directory cannot be read")
		}
		type entry struct {
			Name      string `json:"name"`
			Size      int64  `json:"size"`
			Directory bool   `json:"directory"`
			Symlink   bool   `json:"symlink"`
		}
		result := []entry{}
		for _, e := range entries {
			if len(result) == 500 {
				break
			}
			result = append(result, entry{e.Name(), e.Size(), e.IsDir(), e.Mode()&os.ModeSymlink != 0})
		}
		return map[string]any{"path": r.Path, "entries": result, "truncated": len(entries) > 500}, nil
	case "download":
		info, err := f.Lstat(r.Path)
		if err != nil || !info.Mode().IsRegular() || info.Size() > HostFileLimit {
			return nil, errors.New("download requires a regular file of at most 8 MiB")
		}
		file, err := f.Open(r.Path)
		if err != nil {
			return nil, errors.New("file cannot be read")
		}
		defer file.Close()
		b, err := io.ReadAll(io.LimitReader(file, HostFileLimit+1))
		if err != nil || len(b) > HostFileLimit {
			return nil, errors.New("file download failed or exceeds 8 MiB")
		}
		return map[string]string{"name": path.Base(r.Path), "data": base64.StdEncoding.EncodeToString(b)}, nil
	case "upload":
		if len(r.Data) > base64.StdEncoding.EncodedLen(HostFileLimit) {
			return nil, errors.New("upload exceeds 8 MiB")
		}
		b, err := base64.StdEncoding.DecodeString(r.Data)
		if err != nil || len(b) > HostFileLimit {
			return nil, errors.New("invalid upload")
		}
		// No overwrite, chmod changes, delete, or automatic sudo. O_EXCL prevents
		// replacing a symlink or an existing file even under concurrent uploads.
		file, err := f.OpenFile(r.Path, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
		if err != nil {
			return nil, errors.New("target exists or is not writable")
		}
		if err = file.Chmod(0600); err != nil {
			file.Close()
			return nil, errors.New("could not secure upload permissions; empty file may remain")
		}
		_, copyErr := io.Copy(file, bytes.NewReader(b))
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil {
			return nil, errors.New("upload failed; partial file may remain")
		}
		return map[string]bool{"uploaded": true}, nil
	}
	return nil, errors.New("unsupported file operation")
}
