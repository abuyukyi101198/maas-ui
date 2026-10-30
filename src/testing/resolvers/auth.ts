import { HttpResponse } from "msw";

import { oAuthProviderFactory } from "../factories/auth";

import type {
  CompleteIntroError,
  CreateOauthProviderError,
  CreateSessionError,
  EntitlementResponse,
  ExtendSessionError,
  GetOauthProviderError,
  HandleOauthCallbackError,
  HandleOauthCallbackResponse,
  InitiateAuthFlowError,
  InitiateAuthFlowResponse,
  LoginError,
  LoginResponse,
  OAuthProviderResponse,
  PreLoginError,
  PreLoginResponse,
  UpdateOauthProviderError,
  UpdateUserMeError,
  UserResponse,
  UserStatisticsResponse,
} from "@/app/apiclient";
import { user, userEntitlements, userStatistics } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockAuth: UserResponse = user({
  id: 1,
  username: "testuser",
  email: "testuser@example.com",
});

const mockUserEntitlements: EntitlementResponse[] = userEntitlements();

const mockAuthStatistics: UserStatisticsResponse = userStatistics({
  id: 1,
});

const mockPreLoginResponse: PreLoginResponse = {
  is_authenticated: false,
  no_users: false,
  kind: "PreLoginResponse",
};

const mockPreLoginError: PreLoginError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockInitiateAuthFlowResponse: InitiateAuthFlowResponse = {
  is_oidc: false,
  kind: "InitiateAuthFlowResponse",
};

const mockInitiateAuthFlowError: InitiateAuthFlowError = {
  message: "No enabled OAuth provider is configured.",
  code: 412,
};

const mockHandleOAuthCallbackResponse: HandleOauthCallbackResponse = {
  redirect_target: "/devices",
  kind: "CallbackTargetResponse",
};

const mockHandleOAuthCallbackError: HandleOauthCallbackError = {
  code: 401,
  message: "The provided state or nonce cookies are invalid.",
};

const mockCreateSessionError: CreateSessionError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockExtendSessionError: ExtendSessionError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockLoginResponse: LoginResponse = {
  token_type: "Bearer",
  access_token: "mock_access_token",
  refresh_token: "mock_refresh_token",
  kind: "AccessTokenResponse",
};

const mockAuthenticateError: LoginError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockCompleteIntroError: CompleteIntroError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockUpdateMeError: UpdateUserMeError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

export const mockOauthProvider: OAuthProviderResponse =
  oAuthProviderFactory.build();

const mockGetOauthProviderError: GetOauthProviderError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockCreateOauthProviderError: CreateOauthProviderError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockupdateOauthProviderError: UpdateOauthProviderError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockDeleteOauthProviderError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const authResolvers = {
  authenticate: createResolver({
    method: "post",
    path: "auth/login",
    data: mockLoginResponse,
    error: mockAuthenticateError,
  }),
  preLogin: createResolver({
    method: "get",
    path: "auth/login",
    data: mockPreLoginResponse,
    error: mockPreLoginError,
  }),
  isOidcUser: createResolver({
    method: "get",
    path: "auth/login_info",
    data: mockInitiateAuthFlowResponse,
    error: mockInitiateAuthFlowError,
  }),
  getCallback: createResolver({
    method: "get",
    path: "auth/oauth/callback",
    data: mockHandleOAuthCallbackResponse,
    error: mockHandleOAuthCallbackError,
  }),
  createSession: createResolver({
    method: "post",
    path: "auth/sessions",
    data: {},
    error: mockCreateSessionError,
  }),
  extendSession: createResolver({
    method: "post",
    path: "auth/sessions:extend",
    data: {},
    error: mockExtendSessionError,
  }),
  getCurrentUser: createResolver({
    method: "get",
    path: "users/me",
    data: mockAuth,
    error: mockAuthenticateError,
  }),
  updateMe: createResolver({
    method: "put",
    path: "users/me",
    data: mockAuth,
    error: mockUpdateMeError,
  }),
  getMeStatistics: createResolver({
    method: "get",
    path: "users/me:statistics",
    data: mockAuthStatistics,
    error: mockAuthenticateError,
  }),
  getMeEntitlements: createResolver({
    method: "get",
    path: "users/me:get_entitlements",
    data: mockUserEntitlements,
    error: mockAuthenticateError,
    respond: (data: EntitlementResponse[] | undefined) =>
      HttpResponse.json({ items: data }),
  }),
  completeIntro: createResolver({
    method: "post",
    path: "users/me:complete_intro",
    data: {},
    error: mockCompleteIntroError,
  }),
  getActiveOauthProvider: createResolver({
    method: "get",
    path: "auth/oauth:is_active",
    data: mockOauthProvider,
    error: mockGetOauthProviderError,
  }),
  createOauthProvider: createResolver({
    method: "post",
    path: "auth/oauth/providers",
    data: {},
    error: mockCreateOauthProviderError,
  }),
  updateOauthProvider: createResolver({
    method: "put",
    path: "auth/oauth/providers/:id",
    data: {},
    error: mockupdateOauthProviderError,
  }),
  deleteOauthProvider: createResolver({
    method: "delete",
    path: "auth/oauth/providers/:id",
    data: {},
    error: mockDeleteOauthProviderError,
  }),
};

export { authResolvers, mockAuth, mockUserEntitlements };
