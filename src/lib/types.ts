export interface Memory {
  id: string;
  title: string;
  narrative: string;
  photos?: { id: string; url: string }[];
  lat: number;
  lng: number;
  locationTag?: string;
  authorName?: string;
  authorAvatar?: string;
  createdAt: string;
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface ActivityEvent {
  id: string;
  type: "memory.created" | "memory.updated" | "memory.commented" | "collection.shared";
  actorName: string;
  memoryId?: string;
  memoryTitle?: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
