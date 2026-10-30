import { HttpResponse } from "msw";

import type {
  CreateGroupError,
  GetGroupError,
  ListGroupEntitlementsResponse,
  ListGroupsError,
  ListGroupsResponse,
  ListGroupsStatisticsResponse,
  ListGroupMembersResponse,
  UserGroupResponse,
} from "@/app/apiclient";
import { Entitlement } from "@/app/settings/views/UserManagement/views/Groups/constants";
import {
  group as groupFactory,
  groupStatistics as groupStatsFactory,
  groupEntitlements as groupEntitlementsFactory,
  groupMember as groupMemberFactory,
} from "@/testing/factories/groups";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockGroups: ListGroupsResponse = {
  items: [
    groupFactory({
      id: 1,
      name: "group1",
      description: "First group",
    }),
    groupFactory({
      id: 2,
      name: "group2",
      description: "Second group",
    }),
    groupFactory({
      id: 3,
      name: "group3",
      description: "Third group",
    }),
  ],
  total: 3,
};

const mockGroupStatistics: ListGroupsStatisticsResponse = {
  items: [
    groupStatsFactory({
      id: 1,
      user_count: 5,
    }),
    groupStatsFactory({
      id: 2,
      user_count: 10,
    }),
    groupStatsFactory({
      id: 3,
      user_count: 15,
    }),
  ],
  total: 3,
};

const mockGroupEntitlements: ListGroupEntitlementsResponse = {
  items: [
    groupEntitlementsFactory({
      entitlement: Entitlement.CAN_DEPLOY_MACHINES,
      resource_id: 0,
      resource_type: "pool",
    }),
    groupEntitlementsFactory({
      entitlement: Entitlement.CAN_VIEW_NOTIFICATIONS,
      resource_type: "maas",
    }),
  ],
  total: 2,
};

const mockGroupMembers: ListGroupMembersResponse = {
  items: [
    groupMemberFactory({
      user_id: 1,
      username: "alice",
      email: "alice@example.com",
    }),
    groupMemberFactory({
      user_id: 2,
      username: "bob",
      email: "bob@example.com",
    }),
  ],
  total: 2,
};

const mockListError: ListGroupsError = {
  message: "Unprocessable Entity",
  code: 422,
  kind: "Error",
};

const mockGetError: GetGroupError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockCreateGroupError: CreateGroupError = {
  message: "A group with this name already exists.",
  code: 409,
  kind: "Error",
};

const groupsResolvers = {
  listGroups: createResolver({
    method: "get",
    path: "groups",
    data: mockGroups,
    error: mockListError,
  }),
  listGroupsStatistics: createResolver({
    method: "get",
    path: "groups:statistics",
    data: mockGroupStatistics,
    error: mockListError,
  }),
  getGroup: createResolver({
    method: "get",
    path: "groups/:id",
    error: mockGetError,
    respond: (data: UserGroupResponse | undefined, { params }) => {
      const group =
        data ??
        mockGroups.items.find((group) => group.id === Number(params.id));
      return group ? HttpResponse.json(group) : notFound();
    },
  }),
  createGroup: createResolver({
    method: "post",
    path: "groups",
    data: { id: 1 },
    error: mockCreateGroupError,
  }),
  updateGroup: createResolver({
    method: "put",
    path: "groups/:id",
    data: {},
    error: mockGetError,
  }),
  deleteGroup: createResolver({
    method: "delete",
    path: "groups/:id",
    data: {},
    error: mockGetError,
  }),
  listGroupEntitlements: createResolver({
    method: "get",
    path: "groups/:id/entitlements",
    data: mockGroupEntitlements,
    error: mockListError,
  }),
  addGroupEntitlement: createResolver({
    method: "post",
    path: "groups/:id/entitlements",
    data: { id: 1 },
    error: mockCreateGroupError,
  }),
  removeGroupEntitlement: createResolver({
    method: "post",
    path: "groups/:id/entitlements:batch_delete",
    data: {},
    error: mockGetError,
  }),
  listGroupMembers: createResolver({
    method: "get",
    path: "groups/:id/members",
    data: mockGroupMembers,
    error: mockListError,
  }),
  addGroupMember: createResolver({
    method: "post",
    path: "groups/:id/members:batch_create",
    data: {},
    error: mockCreateGroupError,
  }),
  removeGroupMember: createResolver({
    method: "delete",
    path: "groups/:id/members",
    data: {},
    error: mockGetError,
  }),
};

export {
  groupsResolvers,
  mockGroups,
  mockGroupStatistics,
  mockGroupEntitlements,
  mockGroupMembers,
};
