import { HttpResponse } from "msw";

import type {
  CreateResourcePoolError,
  GetResourcePoolError,
  GetResourcePoolResponse,
  ListResourcePoolsError,
  ListResourcePoolsResponse,
  UpdateResourcePoolError,
} from "@/app/apiclient";
import { resourcePool } from "@/testing/factories";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockPools: ListResourcePoolsResponse = {
  items: [
    resourcePool({
      name: "swimming",
      description: "place where you go to swim",
      machine_ready_count: 5,
      machine_total_count: 10,
      is_default: true,
      permissions: ["edit", "delete"],
    }),
    resourcePool({
      name: "gene",
      description: "a collection of genes",
      machine_ready_count: 1,
      machine_total_count: 2,
      is_default: false,
      permissions: [],
    }),
    resourcePool({
      name: "car",
      description: "a company car",
      machine_ready_count: 0,
      machine_total_count: 0,
      is_default: false,
      permissions: ["edit", "delete"],
    }),
  ],
  total: 3,
};

const mockListPoolsError: ListResourcePoolsError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockGetPoolError: GetResourcePoolError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockCreatePoolError: CreateResourcePoolError = {
  message: "A pool with this name already exists.",
  code: 409,
  kind: "Error",
};

const mockUpdatePoolError: UpdateResourcePoolError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const poolsResolvers = {
  listPools: createResolver({
    method: "get",
    path: "resource_pools:statistics",
    data: mockPools,
    error: mockListPoolsError,
  }),
  getPool: createResolver({
    method: "get",
    path: "resource_pools/:id",
    error: mockGetPoolError,
    respond: (data: GetResourcePoolResponse | undefined, { params }) => {
      const pool =
        data ?? mockPools.items.find((pool) => pool.id === Number(params.id));
      return pool ? HttpResponse.json(pool) : notFound();
    },
  }),
  createPool: createResolver({
    method: "post",
    path: "resource_pools",
    data: { id: 1 },
    error: mockCreatePoolError,
  }),
  updatePool: createResolver({
    method: "put",
    path: "resource_pools/:id",
    data: {},
    error: mockUpdatePoolError,
  }),
  deletePool: createResolver({
    method: "delete",
    path: "resource_pools/:id",
    data: {},
    status: 204,
    error: mockGetPoolError,
  }),
};

export { poolsResolvers, mockPools };
