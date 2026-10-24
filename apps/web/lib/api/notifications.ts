import {
  NotificationListResponseSchema,
  notificationsEndpoints,
} from "@instagram/contracts";
import { createApiClient } from "./client";
import { withPath } from "./social";

export const createNotificationsClient = () => ({
  list: (cursor?: string, signal?: AbortSignal) =>
    createApiClient().request(
      withPath(notificationsEndpoints.list, {}, { cursor }),
      NotificationListResponseSchema,
      { signal },
    ),
});
