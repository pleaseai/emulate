import type { Entity } from '@emulators/core'

export interface NaverApp extends Entity {
  client_id: string
  client_secret: string
  callback_urls: string[]
}

export interface NaverUser extends Entity {
  // Naver's unique user identifier (string) — exposed as `id` in the profile API.
  // Named `naver_id` here to distinguish from the core Entity numeric `id`.
  naver_id: string
  name: string
  nickname?: string
  email?: string
  gender?: string
  birthyear?: string
  birthday?: string
  age?: string
  mobile?: string
  profile_image?: string
}

export interface NaverAuthCode extends Entity {
  code: string
  client_id: string
  naver_id: string
  redirect_uri: string
  state: string
  expires_at: number // epoch ms; code valid for 10 minutes, single use
  used: boolean
}

export interface NaverToken extends Entity {
  access_token: string
  refresh_token: string
  client_id: string
  naver_id: string
  expires_at: number // epoch ms
  revoked: boolean
}
