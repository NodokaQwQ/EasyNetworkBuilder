package coreadapter

import (
	"testing"

	"github.com/xtls/xray-core/proxy/shadowsocks"
)

func TestXraySSCipherCompatibility(t *testing.T) {
	for _, method := range []string{"none", "plain", "unsupported"} {
		if got := xraySSCipherType(method); got != shadowsocks.CipherType_UNKNOWN {
			t.Errorf("removed or unknown cipher %q mapped to %v", method, got)
		}
	}
	if got := xraySSCipherType("aes-128-gcm"); got != shadowsocks.CipherType_AES_128_GCM {
		t.Errorf("supported cipher mapped to %v", got)
	}
}
