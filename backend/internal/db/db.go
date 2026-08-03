package db

import (
	"database/sql"
	"fmt"
	"strings"

	"os"

	"waypoint-backend/internal/config"
	"waypoint-backend/internal/models"

	_ "github.com/lib/pq"
)

type DB struct {
	*sql.DB
}

func Connect(cfg *config.Config) (*DB, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName, cfg.DBSSLMode,
	)

	database, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open postgres connection: %w", err)
	}

	if err := database.Ping(); err != nil {
		// Check if database does not exist (SQLSTATE 3D000)
		if strings.Contains(err.Error(), "does not exist") || strings.Contains(err.Error(), "3D000") {
			fmt.Printf("Database %q does not exist. Attempting to create it automatically...\n", cfg.DBName)
			defaultConnStr := fmt.Sprintf(
				"host=%s port=%s user=%s password=%s dbname=postgres sslmode=%s",
				cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBSSLMode,
			)
			defaultDB, errOpen := sql.Open("postgres", defaultConnStr)
			if errOpen == nil {
				_, createErr := defaultDB.Exec(fmt.Sprintf("CREATE DATABASE %q", cfg.DBName))
				defaultDB.Close()
				if createErr == nil {
					fmt.Printf("Successfully created database %q!\n", cfg.DBName)
					err = database.Ping()
				} else {
					fmt.Printf("Failed to auto-create database %q: %v\n", cfg.DBName, createErr)
				}
			}
		}

		if err != nil {
			fmt.Printf("Warning: Could not ping PostgreSQL at %s:%s: %v\n", cfg.DBHost, cfg.DBPort, err)
		}
	}

	return &DB{DB: database}, nil
}

func (db *DB) InitSchema() error {
	schemaBytes, err := os.ReadFile("internal/db/schema.sql")
	if err != nil {
		return fmt.Errorf("failed to read schema.sql: %w", err)
	}

	_, err = db.Exec(string(schemaBytes))
	if err != nil {
		return fmt.Errorf("failed to execute init schema: %w", err)
	}
	return nil
}

func (db *DB) CreateUser(u *models.User) error {
	query := `
		INSERT INTO users (id, email, password_hash, name, avatar_url, google_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := db.Exec(query, u.ID, u.Email, u.PasswordHash, u.Name, u.AvatarURL, u.GoogleID, u.CreatedAt, u.UpdatedAt)
	return err
}

func (db *DB) GetUserByEmail(email string) (*models.User, error) {
	query := `
		SELECT id, email, password_hash, name, avatar_url, google_id, created_at, updated_at
		FROM users WHERE email = $1
	`
	row := db.QueryRow(query, email)

	var u models.User
	var googleID sql.NullString
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.AvatarURL, &googleID, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}

	if googleID.Valid {
		u.GoogleID = &googleID.String
	}

	return &u, nil
}

func (db *DB) GetUserByID(id string) (*models.User, error) {
	query := `
		SELECT id, email, password_hash, name, avatar_url, google_id, created_at, updated_at
		FROM users WHERE id = $1
	`
	row := db.QueryRow(query, id)

	var u models.User
	var googleID sql.NullString
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.AvatarURL, &googleID, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}

	if googleID.Valid {
		u.GoogleID = &googleID.String
	}

	return &u, nil
}

func (db *DB) GetUserByGoogleID(googleID string) (*models.User, error) {
	query := `
		SELECT id, email, password_hash, name, avatar_url, google_id, created_at, updated_at
		FROM users WHERE google_id = $1
	`
	row := db.QueryRow(query, googleID)

	var u models.User
	var gID sql.NullString
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.AvatarURL, &gID, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}

	if gID.Valid {
		u.GoogleID = &gID.String
	}

	return &u, nil
}

func (db *DB) UpdateUserGoogleID(userID, googleID, avatarURL string) error {
	query := `
		UPDATE users SET google_id = $1, avatar_url = $2, updated_at = NOW()
		WHERE id = $3
	`
	_, err := db.Exec(query, googleID, avatarURL, userID)
	return err
}
