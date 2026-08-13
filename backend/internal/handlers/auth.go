package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"waypoint-backend/internal/auth"
	"waypoint-backend/internal/config"
	"waypoint-backend/internal/db"
	"waypoint-backend/internal/middleware"
	"waypoint-backend/internal/models"
)

type AuthHandler struct {
	cfg          *config.Config
	db           *db.DB
	googleConfig *auth.GoogleOAuthConfig
}

func NewAuthHandler(cfg *config.Config, database *db.DB) *AuthHandler {
	return &AuthHandler{
		cfg:          cfg,
		db:           database,
		googleConfig: auth.NewGoogleOAuthConfig(cfg),
	}
}

// generateID creates a unique random string ID for new users.
func generateID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Register handles user sign up.
// CRITICAL: User password is explicitly hashed using bcrypt before being persisted to PostgreSQL.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)

	if req.Email == "" || req.Password == "" {
		http.Error(w, `{"error":"Email and password are required"}`, http.StatusBadRequest)
		return
	}

	// Validate email format
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@gmail\.com$`)
	if !emailRegex.MatchString(req.Email) {
		http.Error(w, `{"error":"Invalid email format"}`, http.StatusBadRequest)
		return
	}

	if len(req.Password) < 6 {
		http.Error(w, `{"error":"Password must be at least 6 characters"}`, http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		req.Name = strings.Split(req.Email, "@")[0]
	}

	// Check if user already exists
	existingUser, err := h.db.GetUserByEmail(req.Email)
	if err == nil && existingUser != nil {
		http.Error(w, `{"error":"User with this email already exists"}`, http.StatusConflict)
		return
	}

	// 1. Hash the user's password using bcrypt
	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, `{"error":"Failed to process password"}`, http.StatusInternalServerError)
		return
	}

	now := time.Now()
	user := &models.User{
		ID:           generateID(),
		Email:        req.Email,
		PasswordHash: hashedPassword, // Storing hashed password ONLY
		Name:         req.Name,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	// 2. Save user to PostgreSQL database
	if err := h.db.CreateUser(user); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Failed to create user: %v"}`, err), http.StatusInternalServerError)
		return
	}

	// 3. Issue JWT Token
	token, err := auth.GenerateToken(user.ID, user.Email, h.cfg.JWTSecret, h.cfg.JWTExpirationHours)
	if err != nil {
		http.Error(w, `{"error":"Failed to generate auth token"}`, http.StatusInternalServerError)
		return
	}

	res := models.AuthResponse{
		Token: token,
		User: models.AuthUser{
			ID:     user.ID,
			Email:  user.Email,
			Name:   user.Name,
			Avatar: user.AvatarURL,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(res)
}

// Login handles user sign in.
// CRITICAL: Compares raw password with the bcrypt hash stored in PostgreSQL.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	if req.Email == "" || req.Password == "" {
		http.Error(w, `{"error":"Email and password are required"}`, http.StatusBadRequest)
		return
	}

	// Validate email format
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@gmail\.com$`)
	if !emailRegex.MatchString(req.Email) {
		http.Error(w, `{"error":"Invalid email format"}`, http.StatusBadRequest)
		return
	}

	// Fetch user from PostgreSQL
	user, err := h.db.GetUserByEmail(req.Email)
	if err != nil || user == nil {
		http.Error(w, `{"error":"Invalid email or password"}`, http.StatusUnauthorized)
		return
	}

	// Verify bcrypt password hash
	if !auth.CheckPasswordHash(req.Password, user.PasswordHash) {
		http.Error(w, `{"error":"Invalid email or password"}`, http.StatusUnauthorized)
		return
	}

	// Issue JWT Token
	token, err := auth.GenerateToken(user.ID, user.Email, h.cfg.JWTSecret, h.cfg.JWTExpirationHours)
	if err != nil {
		http.Error(w, `{"error":"Failed to generate auth token"}`, http.StatusInternalServerError)
		return
	}

	res := models.AuthResponse{
		Token: token,
		User: models.AuthUser{
			ID:     user.ID,
			Email:  user.Email,
			Name:   user.Name,
			Avatar: user.AvatarURL,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

// Me retrieves the current logged-in user details.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middleware.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	user, err := h.db.GetUserByID(userID)
	if err != nil || user == nil {
		http.Error(w, `{"error":"User not found"}`, http.StatusNotFound)
		return
	}

	authUser := models.AuthUser{
		ID:     user.ID,
		Email:  user.Email,
		Name:   user.Name,
		Avatar: user.AvatarURL,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(authUser)
}

// GoogleLogin initiates Google OAuth2 redirect.
func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	if h.cfg.GoogleClientID == "" || h.cfg.GoogleClientID == "your-google-client-id.apps.googleusercontent.com" {
		http.Error(w, `{"error":"Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env"}`, http.StatusBadRequest)
		return
	}

	state := auth.GenerateStateOauthCookie(w)
	url := h.googleConfig.Config.AuthCodeURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// GoogleCallback handles redirect back from Google OAuth.
func (h *AuthHandler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("oauthstate")
	if err != nil || cookie.Value == "" {
		http.Error(w, `{"error":"Missing or invalid OAuth state cookie"}`, http.StatusBadRequest)
		return
	}

	state := r.FormValue("state")
	if state != cookie.Value {
		http.Error(w, `{"error":"OAuth state mismatch"}`, http.StatusBadRequest)
		return
	}

	code := r.FormValue("code")
	if code == "" {
		http.Error(w, `{"error":"Code not found in callback"}`, http.StatusBadRequest)
		return
	}

	// Exchange code for Google user details
	gUser, err := h.googleConfig.FetchGoogleUserInfo(r.Context(), code)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Failed to fetch user from Google: %v"}`, err), http.StatusInternalServerError)
		return
	}

	now := time.Now()
	var user *models.User

	// Check if user exists by Google ID
	existingByGoogle, _ := h.db.GetUserByGoogleID(gUser.ID)
	if existingByGoogle != nil {
		user = existingByGoogle
	} else {
		// Check if user exists by email
		existingByEmail, _ := h.db.GetUserByEmail(gUser.Email)
		if existingByEmail != nil {
			user = existingByEmail
			_ = h.db.UpdateUserGoogleID(user.ID, gUser.ID, gUser.Picture)
			user.GoogleID = &gUser.ID
			if gUser.Picture != "" {
				user.AvatarURL = gUser.Picture
			}
		} else {
			// Create new user for Google Sign-In
			user = &models.User{
				ID:           generateID(),
				Email:        gUser.Email,
				PasswordHash: "", // No password for OAuth users
				Name:         gUser.Name,
				AvatarURL:    gUser.Picture,
				GoogleID:     &gUser.ID,
				CreatedAt:    now,
				UpdatedAt:    now,
			}
			_ = h.db.CreateUser(user)
		}
	}

	// Generate JWT Token
	token, err := auth.GenerateToken(user.ID, user.Email, h.cfg.JWTSecret, h.cfg.JWTExpirationHours)
	if err != nil {
		http.Error(w, `{"error":"Failed to generate token"}`, http.StatusInternalServerError)
		return
	}

	// Redirect to frontend with token parameter
	redirectURL := fmt.Sprintf("%s/login?token=%s&userId=%s&email=%s&name=%s",
		h.cfg.FrontendURL,
		url.QueryEscape(token),
		url.QueryEscape(user.ID),
		url.QueryEscape(user.Email),
		url.QueryEscape(user.Name),
	)

	http.Redirect(w, r, redirectURL, http.StatusSeeOther)
}
