import { HttpResponse } from "msw";

import type {
  CreateSwitchError,
  DeleteSwitchError,
  GetSwitchError,
  GetSwitchResponse,
  ListSwitchesError,
  UpdateSwitchError,
} from "@/app/apiclient";
import { switchFactory } from "@/testing/factories/switches";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockSwitches = { items: switchFactory.buildList(3), total: 3 };

const mockListSwitchesError: ListSwitchesError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error",
};

const mockGetSwitchError: GetSwitchError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockCreateSwitchError: CreateSwitchError = {
  message: "A switch with this MAC address already exists.",
  code: 409,
  kind: "Error",
};

const mockUpdateSwitchError: UpdateSwitchError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockDeleteSwitchError: DeleteSwitchError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const switchResolvers = {
  listSwitches: createResolver({
    method: "get",
    path: "switches",
    data: mockSwitches,
    error: mockListSwitchesError,
  }),
  getSwitch: createResolver({
    method: "get",
    path: "switches/:switch_id",
    error: mockGetSwitchError,
    respond: (data: GetSwitchResponse | undefined, { params }) => {
      const sw =
        data ??
        mockSwitches.items.find((s) => s.id === Number(params.switch_id));
      return sw ? HttpResponse.json(sw) : notFound();
    },
  }),
  createSwitch: createResolver({
    method: "post",
    path: "switches",
    data: { id: 1 },
    error: mockCreateSwitchError,
  }),
  updateSwitch: createResolver({
    method: "patch",
    path: "switches/:switch_id",
    data: {},
    error: mockUpdateSwitchError,
  }),
  deleteSwitch: createResolver({
    method: "delete",
    path: "switches/:switch_id",
    data: {},
    status: 204,
    error: mockDeleteSwitchError,
  }),
};

export { mockSwitches, switchResolvers };
