package auth

import (
	"testing"
)

func TestPasswordHashing(t *testing.T) {
	password := "mySuperSecret123!"

	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("Expected no error when hashing password, got: %v", err)
	}

	if hash == password {
		t.Fatalf("Hash should not equal original plain text password")
	}

	if !CheckPasswordHash(password, hash) {
		t.Fatalf("Expected password check to succeed for correct password")
	}

	if CheckPasswordHash("wrongPassword", hash) {
		t.Fatalf("Expected password check to fail for incorrect password")
	}
}

func TestJWTTokenGenerationAndValidation(t *testing.T) {
	userID := "usr_12345"
	email := "test@example.com"
	secret := "test-secret-key-12345"
	expHours := 1

	tokenStr, err := GenerateToken(userID, email, secret, expHours)
	if err != nil {
		t.Fatalf("Expected no error generating JWT, got: %v", err)
	}

	claims, err := ValidateToken(tokenStr, secret)
	if err != nil {
		t.Fatalf("Expected no error validating JWT, got: %v", err)
	}

	if claims.UserID != userID {
		t.Errorf("Expected UserID %s, got %s", userID, claims.UserID)
	}

	if claims.Email != email {
		t.Errorf("Expected Email %s, got %s", email, claims.Email)
	}

	// Test invalid secret
	_, err = ValidateToken(tokenStr, "wrong-secret-key")
	if err == nil {
		t.Errorf("Expected validation failure when using invalid secret")
	}
}
