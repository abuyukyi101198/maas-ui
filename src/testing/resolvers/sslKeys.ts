import type {
  CreateUserSslkeyError,
  DeleteUserSslkeyError,
  GetUserSslkeysError,
  GetUserSslkeysResponse,
} from "@/app/apiclient";
import { sslKey } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockSslKeys: GetUserSslkeysResponse = {
  items: [
    sslKey({
      id: 1,
      key: "test key",
    }),
    sslKey({
      id: 2,
      key: "test key 2",
    }),
    sslKey({
      id: 3,
      key: "test key 3",
    }),
  ],
  total: 3,
};

const mockGetSslKeysError: GetUserSslkeysError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockCreateSslKeysError: CreateUserSslkeyError = {
  message: "An SSL key with this fingerprint already exists.",
  code: 409,
  kind: "Error",
};

const mockDeleteSslKeyError: DeleteUserSslkeyError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const sslKeyResolvers = {
  listSslKeys: createResolver({
    method: "get",
    path: "users/me/sslkeys",
    data: mockSslKeys,
    error: mockGetSslKeysError,
  }),
  createSslKey: createResolver({
    method: "post",
    path: "users/me/sslkeys",
    data: {},
    error: mockCreateSslKeysError,
  }),
  deleteSslKey: createResolver({
    method: "delete",
    path: "users/me/sslkeys/:id",
    data: {},
    status: 204,
    error: mockDeleteSslKeyError,
  }),
};

export { sslKeyResolvers, mockSslKeys };
