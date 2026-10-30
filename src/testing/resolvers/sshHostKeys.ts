import type {
  CreateSshHostKeyError,
  DeleteSshHostKeyError,
  ListSshHostKeysError,
  ListSshHostKeysResponse,
} from "@/app/apiclient";
import { sshHostKey as sshHostKeyFactory } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockSshHostKeys: ListSshHostKeysResponse = {
  items: [
    sshHostKeyFactory({ id: 1 }),
    sshHostKeyFactory({ id: 2 }),
    sshHostKeyFactory({ id: 3 }),
  ],
  total: 3,
};

const mockListSshHostKeysError: ListSshHostKeysError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error",
};

const mockCreateSshHostKeyError: CreateSshHostKeyError = {
  message: "Unprocessable entity",
  code: 422,
  kind: "Error",
};

const mockDeleteSshHostKeyError: DeleteSshHostKeyError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const sshHostKeysResolvers = {
  listSshHostKeys: createResolver({
    method: "get",
    path: "ssh-host-keys",
    data: mockSshHostKeys,
    error: mockListSshHostKeysError,
  }),
  createSshHostKey: createResolver({
    method: "post",
    path: "ssh-host-keys",
    data: sshHostKeyFactory({ id: 4 }),
    status: 201,
    error: mockCreateSshHostKeyError,
  }),
  deleteSshHostKey: createResolver({
    method: "delete",
    path: "ssh-host-keys/:id",
    data: {},
    status: 204,
    error: mockDeleteSshHostKeyError,
  }),
};

export { mockSshHostKeys, sshHostKeysResolvers };
