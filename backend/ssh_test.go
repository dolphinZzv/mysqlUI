package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"testing"

	"golang.org/x/crypto/ssh"
)

func testPrivateKeyPEM(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return string(pem.EncodeToMemory(block))
}

func TestBuildSSHClientConfig(t *testing.T) {
	key := testPrivateKeyPEM(t)

	cases := []struct {
		name     string
		cfg      *SSHConfig
		wantErr  bool
		wantAuth int
	}{
		{"nil config", nil, true, 0},
		{"disabled", &SSHConfig{Enabled: false}, true, 0},
		{"missing host", &SSHConfig{Enabled: true, User: "u", Password: "p"}, true, 0},
		{"missing user", &SSHConfig{Enabled: true, Host: "h", Password: "p"}, true, 0},
		{"missing auth", &SSHConfig{Enabled: true, Host: "h", User: "u"}, true, 0},
		{"password", &SSHConfig{Enabled: true, Host: "h", User: "u", Password: "p"}, false, 1},
		{"private key", &SSHConfig{Enabled: true, Host: "h", User: "u", PrivateKey: key}, false, 1},
		{"key and password", &SSHConfig{Enabled: true, Host: "h", User: "u", PrivateKey: key, Password: "p"}, false, 2},
		{"invalid key", &SSHConfig{Enabled: true, Host: "h", User: "u", PrivateKey: "not-a-key"}, true, 0},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := buildSSHClientConfig(c.cfg)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got config %#v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got.Auth) != c.wantAuth {
				t.Errorf("auth methods = %d, want %d", len(got.Auth), c.wantAuth)
			}
			if got.User != "u" {
				t.Errorf("user = %q, want u", got.User)
			}
			if got.HostKeyCallback == nil {
				t.Error("HostKeyCallback is nil")
			}
		})
	}
}

func TestHostKeyCallbackIgnore(t *testing.T) {
	cb, err := hostKeyCallback(true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cb == nil {
		t.Fatal("expected non-nil callback")
	}
}

func TestTunnelEnsureDisabled(t *testing.T) {
	tunnel := &sshTunnel{}
	network, err := tunnel.ensure(Connection{ID: "test"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if network != "tcp" {
		t.Errorf("network = %q, want tcp", network)
	}
}

func TestConnectionInputSSHValidation(t *testing.T) {
	in := connectionInput{Name: "n", Host: "db", User: "root", SSH: &SSHConfig{Enabled: true}}
	if err := in.validate(); err == nil {
		t.Error("expected error for missing ssh host")
	}
	in.SSH.Host = "bastion"
	if err := in.validate(); err == nil {
		t.Error("expected error for missing ssh user")
	}
	in.SSH.User = "deploy"
	if err := in.validate(); err == nil {
		t.Error("expected error for missing ssh credentials")
	}
	in.SSH.Password = "secret"
	if err := in.validate(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	// Disabled SSH should not require any fields.
	in.SSH = &SSHConfig{Enabled: false}
	if err := in.validate(); err != nil {
		t.Errorf("unexpected error for disabled ssh: %v", err)
	}
}
