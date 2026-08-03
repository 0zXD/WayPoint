package models

import "time"

type Memory struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId,omitempty"`
	Title       string    `json:"title"`
	Narrative   string    `json:"narrative"`
	Lat         float64   `json:"lat"`
	Lng         float64   `json:"lng"`
	LocationTag string    `json:"locationTag,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`

	// Joined fields for frontend presentation
	Photos       []PhotoResponse `json:"photos"`
	AuthorName   string          `json:"authorName,omitempty"`
	AuthorAvatar string          `json:"authorAvatar,omitempty"`
}

type PhotoResponse struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type Photo struct {
	ID          string `json:"id"`
	MemoryID    string `json:"memoryId"`
	ImageBase64 string `json:"imageBase64"`
	MimeType    string `json:"mimeType"`
}
