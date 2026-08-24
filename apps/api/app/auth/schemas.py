from pydantic import BaseModel, Field

# Mirrors openapi.yaml LoginRequest/LoginResponse/UserProfile/InfluencerProfile.
# email stays a plain str — email-validator isn't installed.


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)


class InfluencerProfile(BaseModel):
    bio: str | None = None
    instagram_handle: str | None = None
    tiktok_handle: str | None = None
    follower_count: int | None = None
    verified: bool = False


class UserProfile(BaseModel):
    user_id: str
    email: str | None = None
    display_name: str | None = None
    role: str | None = None
    created_at: str | None = None
    influencer_profile: InfluencerProfile | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int | None = None
    user: UserProfile
