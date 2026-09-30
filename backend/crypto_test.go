package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCipherRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	c, err := NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher: %v", err)
	}
	enc, err := c.Encrypt("s3cret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !strings.HasPrefix(enc, encryptedPrefix) {
		t.Fatalf("encrypted value missing prefix: %q", enc)
	}
	if strings.Contains(enc, "s3cret") {
		t.Fatal("ciphertext leaks plaintext")
	}
	dec, err := c.Decrypt(enc)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if dec != "s3cret" {
		t.Fatalf("round trip = %q", dec)
	}
	// Plaintext values pass through unchanged for backwards compatibility.
	if got, _ := c.Decrypt("plain"); got != "plain" {
		t.Fatalf("plain decrypt = %q", got)
	}
	// Empty input stays empty.
	if got, _ := c.Encrypt(""); got != "" {
		t.Fatalf("empty encrypt = %q", got)
	}
}

func TestCipherRejectsWrongKey(t *testing.T) {
	k1 := make([]byte, 32)
	k2 := make([]byte, 32)
	k2[0] = 9
	c1, _ := NewCipher(k1)
	c2, _ := NewCipher(k2)
	enc, _ := c1.Encrypt("secret")
	if _, err := c2.Decrypt(enc); err == nil {
		t.Fatal("expected decryption with a different key to fail")
	}
}

func TestStoreEncryptsSecretsAtRest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "connections.json")
	key, err := LoadKey(dir)
	if err != nil {
		t.Fatalf("LoadKey: %v", err)
	}
	cipher, err := NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher: %v", err)
	}

	store, err := NewStoreWithCipher(path, cipher)
	if err != nil {
		t.Fatalf("NewStoreWithCipher: %v", err)
	}
	_, err = store.Create(Connection{
		Name:     "prod",
		Host:     "db.example.com",
		Port:     3306,
		User:     "root",
		Password: "db-password",
		SSH: &SSHConfig{
			Enabled:    true,
			Host:       "bastion",
			User:       "deploy",
			Password:   "ssh-password",
			PrivateKey: "-----BEGIN KEY-----",
			Passphrase: "key-pass",
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// The raw file must not contain any of the secrets in cleartext.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read store: %v", err)
	}
	for _, secret := range []string{"db-password", "ssh-password", "key-pass"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("store leaks %q: %s", secret, raw)
		}
	}
	if !strings.Contains(string(raw), encryptedPrefix) {
		t.Fatalf("store is not encrypted: %s", raw)
	}
	var onDisk []Connection
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("unmarshal store: %v", err)
	}
	if len(onDisk) != 1 || !isEncrypted(onDisk[0].Password) {
		t.Fatalf("password should be encrypted on disk: %#v", onDisk)
	}

	// Reloading decrypts it transparently.
	reloaded, err := NewStoreWithCipher(path, cipher)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	list := reloaded.List()
	if len(list) != 1 {
		t.Fatalf("reloaded %d connections", len(list))
	}
	got := list[0]
	if got.Password != "db-password" {
		t.Fatalf("password = %q", got.Password)
	}
	if got.SSH == nil || got.SSH.Password != "ssh-password" || got.SSH.Passphrase != "key-pass" {
		t.Fatalf("ssh secrets = %#v", got.SSH)
	}
}

func TestStorePlaintextMigration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "connections.json")
	// A pre-existing plaintext store.
	seed := []Connection{{ID: "abc", Name: "legacy", Host: "h", Port: 3306, User: "u", Password: "legacy-pass"}}
	data, _ := json.Marshal(seed)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	key, _ := LoadKey(dir)
	cipher, _ := NewCipher(key)

	store, err := NewStoreWithCipher(path, cipher)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := store.List()[0].Password; got != "legacy-pass" {
		t.Fatalf("migrated password = %q", got)
	}
	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), "legacy-pass") {
		t.Fatalf("migration left plaintext: %s", raw)
	}
}

func TestRedactConnection(t *testing.T) {
	in := Connection{
		Name:     "prod",
		Host:     "h",
		User:     "u",
		Password: "db-pass",
		SSH:      &SSHConfig{Enabled: true, Password: "ssh-pass", PrivateKey: "key", Passphrase: "pp"},
	}
	out := redactConnection(in)
	if out.Password != "" {
		t.Fatalf("password not redacted: %q", out.Password)
	}
	if out.SSH == nil || out.SSH.Password != "" || out.SSH.PrivateKey != "" || out.SSH.Passphrase != "" {
		t.Fatalf("ssh secrets not redacted: %#v", out.SSH)
	}
	// The original is left untouched.
	if in.Password != "db-pass" {
		t.Fatal("redactConnection mutated its input")
	}
}
