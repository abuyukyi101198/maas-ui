import type {
  CreateUserSshkeysError,
  DeleteUserSshkeyError,
  ImportUserSshkeysError,
  ListUserSshkeysError,
  ListUserSshkeysResponse,
} from "@/app/apiclient";
import { sshKey as sshKeyFactory } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockSshKeys: ListUserSshkeysResponse = {
  items: [
    sshKeyFactory({
      id: 1,
      protocol: "lp",
      auth_id: "test auth id",
      kind: "sshkey",
      key: "test key",
    }),
    sshKeyFactory({
      id: 2,
      protocol: undefined,
      auth_id: undefined,
      kind: "sshkey",
      key: "test key 2",
    }),
    sshKeyFactory({
      id: 3,
      protocol: "gh",
      auth_id: "another test auth id",
      kind: "sshkey",
      key: "test key 3",
    }),
  ],
  total: 3,
};

const mockListSshKeysError: ListUserSshkeysError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockCreateSshKeysError: CreateUserSshkeysError = {
  message: "An SSH key with this fingerprint already exists.",
  code: 409,
  kind: "Error",
};

const mockImportSshKeysError: ImportUserSshkeysError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockDeleteSshKeyError: DeleteUserSshkeyError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const sshKeyResolvers = {
  listSshKeys: createResolver({
    method: "get",
    path: "users/me/sshkeys",
    data: mockSshKeys,
    error: mockListSshKeysError,
  }),
  createSshKey: createResolver({
    method: "post",
    path: "users/me/sshkeys",
    data: {},
    error: mockCreateSshKeysError,
  }),
  importSshKey: createResolver({
    method: "post",
    path: "users/me/sshkeys:import",
    data: {},
    error: mockImportSshKeysError,
  }),
  deleteSshKey: createResolver({
    method: "delete",
    path: "users/me/sshkeys/:id",
    data: {},
    status: 204,
    error: mockDeleteSshKeyError,
  }),
};

export { sshKeyResolvers, mockSshKeys };
