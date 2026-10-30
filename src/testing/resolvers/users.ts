import { HttpResponse } from "msw";

import type {
  CreateUserError,
  GetUserError,
  ListUsersError,
  ListUsersResponse,
  ListUsersStatisticsError,
  ListUsersStatisticsResponse,
  UpdateUserError,
  UserResponse,
} from "@/app/apiclient";
import {
  user as userFactory,
  userStatistics as userStatisticsFactory,
} from "@/testing/factories";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockUsers: ListUsersResponse = {
  items: [
    userFactory({
      id: 1,
      email: "user1@example.com",
      username: "user1",
    }),
    userFactory({
      id: 2,
      email: "user2@example.com",
      username: "user2",
    }),
    userFactory({
      id: 3,
      email: "user3@example.com",
      username: "user3",
    }),
  ],
  total: 3,
};

const mockUsersStatistics: ListUsersStatisticsResponse = {
  items: [
    userStatisticsFactory({
      id: 1,
    }),
    userStatisticsFactory({
      id: 2,
    }),
    userStatisticsFactory({
      id: 3,
    }),
  ],
  total: 3,
};

const mockListUsersError: ListUsersError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockListUsersStatisticsError: ListUsersStatisticsError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error",
};

const mockGetUserError: GetUserError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockCreateUserError: CreateUserError = {
  message: "A user with this name already exists.",
  code: 409,
  kind: "Error",
};

const mockUpdateUserError: UpdateUserError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const usersResolvers = {
  listUsers: createResolver({
    method: "get",
    path: "users",
    data: mockUsers,
    error: mockListUsersError,
  }),
  listUsersStatistics: createResolver({
    method: "get",
    path: "users:statistics",
    data: mockUsersStatistics,
    error: mockListUsersStatisticsError,
  }),
  getUser: createResolver({
    method: "get",
    path: "users/:id",
    error: mockGetUserError,
    respond: (data: UserResponse | undefined, { params }) => {
      const user =
        data ?? mockUsers.items.find((user) => user.id === Number(params.id));
      return user ? HttpResponse.json(user) : notFound();
    },
  }),
  createUser: createResolver({
    method: "post",
    path: "users",
    data: { id: 1 },
    error: mockCreateUserError,
  }),
  updateUser: createResolver({
    method: "put",
    path: "users/:id",
    data: {},
    error: mockUpdateUserError,
  }),
  deleteUser: createResolver({
    method: "delete",
    path: "users/:id",
    data: {},
    status: 204,
    error: mockGetUserError,
  }),
};

export { mockUsers, mockUsersStatistics, usersResolvers };
