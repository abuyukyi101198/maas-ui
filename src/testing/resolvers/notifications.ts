import { HttpResponse } from "msw";

import type {
  DismissNotificationError,
  ListNotificationsError,
  ListNotificationsResponse,
} from "@/app/apiclient";
import { notificationFactoryV3 } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockNotifications: ListNotificationsResponse = {
  items: [
    notificationFactoryV3({
      id: 1,
      users: true,
      admins: true,
      message: "This is a success message",
      category: "success",
      context: {},
    }),
    notificationFactoryV3({
      id: 2,
      users: true,
      admins: true,
      message: "This is an info message",
      category: "info",
      context: {},
    }),
    notificationFactoryV3({
      id: 3,
      users: true,
      admins: true,
      message: "This is a warning message",
      category: "warning",
      context: {},
    }),
  ],
  total: 3,
};

const mockListNotificationsError: ListNotificationsError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockDismissNotificationError: DismissNotificationError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const notificationResolvers = {
  listNotifications: createResolver({
    method: "get",
    path: "notifications",
    data: mockNotifications,
    error: mockListNotificationsError,
    respond: (data: ListNotificationsResponse | undefined, { request }) => {
      const notifications = data ?? mockNotifications;
      const params = new URL(request.url).searchParams;
      const page = Number(params.get("page") ?? 1);
      const size = Number(params.get("size") ?? notifications.items.length);
      return HttpResponse.json({
        ...notifications,
        items: notifications.items.slice((page - 1) * size, page * size),
      });
    },
  }),
  dismissNotification: createResolver({
    method: "post",
    path: "notifications/:id:dismiss",
    data: {},
    error: mockDismissNotificationError,
  }),
};

export { notificationResolvers, mockNotifications };
