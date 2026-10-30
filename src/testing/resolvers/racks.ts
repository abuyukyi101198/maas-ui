import { HttpResponse } from "msw";

import type {
  CreateRackError,
  GenerateRackBootstrapTokenError,
  GetRackError,
  GetRackResponse,
  ListRacksError,
  UpdateRackError,
} from "@/app/apiclient";
import { rackFactory } from "@/testing/factories/racks";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockRacks = { items: rackFactory.buildList(15), total: 15 };

const mockListRacksError: ListRacksError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockGetRackError: GetRackError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockCreateRackError: CreateRackError = {
  message: "A rack with this name already exists.",
  code: 409,
  kind: "Error",
};

const mockUpdateRackError: UpdateRackError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockGenerateRackBootstrapTokenError: GenerateRackBootstrapTokenError = {
  message: "Bad request",
  code: 400,
  kind: "Error",
};

const rackResolvers = {
  listRacks: createResolver({
    method: "get",
    path: "racks_with_summary",
    data: mockRacks,
    error: mockListRacksError,
  }),
  getRack: createResolver({
    method: "get",
    path: "racks/:id",
    error: mockGetRackError,
    respond: (data: GetRackResponse | undefined, { params }) => {
      const rack =
        data ?? mockRacks.items.find((rack) => rack.id === Number(params.id));
      return rack ? HttpResponse.json(rack) : notFound();
    },
  }),
  createRack: createResolver({
    method: "post",
    path: "racks",
    data: { id: 1 },
    error: mockCreateRackError,
  }),
  updateRack: createResolver({
    method: "put",
    path: "racks/:id",
    data: {},
    error: mockUpdateRackError,
  }),
  deleteRack: createResolver({
    method: "delete",
    path: "racks/:id",
    data: {},
    status: 204,
    error: mockGetRackError,
  }),
  generateToken: createResolver({
    method: "post",
    path: "racks/:id/tokens:generate",
    data: {
      token: "generated-token",
      kind: "RackBootstrapToken",
    },
    error: mockGenerateRackBootstrapTokenError,
  }),
};

export { mockRacks, rackResolvers };
