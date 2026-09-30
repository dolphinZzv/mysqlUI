package main

import (
	"testing"
	"time"
)

func TestHOTPRFC4226(t *testing.T) {
	// RFC 4226 appendix D uses the ASCII secret "12345678901234567890".
	key := []byte("12345678901234567890")
	vectors := map[int64]string{
		0: "755224",
		1: "287082",
		2: "359152",
		3: "969429",
		4: "338314",
		5: "254676",
	}
	for counter, want := range vectors {
		if got := hotp(key, counter); got != want {
			t.Errorf("hotp(%d) = %s, want %s", counter, got, want)
		}
	}
}

func TestValidateTOTP(t *testing.T) {
	// Base32 of "12345678901234567890".
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	at := time.Unix(59, 0) // counter 1 -> 287082

	if !validateTOTP(secret, "287082", at) {
		t.Fatal("expected the valid code to be accepted")
	}
	// Adjacent steps are accepted for clock skew.
	if !validateTOTP(secret, "755224", at) {
		t.Error("expected the previous step to be accepted")
	}
	if validateTOTP(secret, "000000", at) {
		t.Error("expected an invalid code to be rejected")
	}
	if validateTOTP("", "287082", at) {
		t.Error("expected an empty secret to be rejected")
	}
	if validateTOTP(secret, "12345", at) {
		t.Error("expected a short code to be rejected")
	}
}
