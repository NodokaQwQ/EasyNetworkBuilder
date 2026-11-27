package flags_pkg

import "testing"

func TestRemotePermissionAllowlist(t *testing.T) {
	previous := GlobalConfig
	defer func() { GlobalConfig = previous }()
	for _, test := range []struct {
		value  string
		master bool
		name   string
		want   bool
	}{
		{"", false, "terminal", false}, {"", true, "terminal", true},
		{"terminal", true, "terminal", true}, {"terminal", true, "files", false},
		{"files,mcp", true, "files", true}, {"files,mcp", true, "exec", false},
		{"terminal", false, "terminal", false}, {"none", true, "terminal", false},
	} {
		GlobalConfig = &Config{RemoteControlEnabled: test.master, RemotePermissions: test.value}
		if got := PermissionAllowed(test.name); got != test.want {
			t.Errorf("%+v got %v", test, got)
		}
	}
}

func TestValidateRemotePermissions(t *testing.T) {
	for _, value := range []string{"", "none", "terminal,files,exec,mcp,firewall,protection"} {
		if err := ValidateRemotePermissions(value); err != nil {
			t.Fatal(value, err)
		}
	}
	for _, value := range []string{"all", "terminal,terminal", "none,exec", "terminal,", "Terminal", "terminal, files"} {
		if ValidateRemotePermissions(value) == nil {
			t.Fatal("accepted", value)
		}
	}
}
