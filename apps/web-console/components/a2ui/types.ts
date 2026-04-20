/** Local mirror of A2UI v0.9 envelope shapes (avoids importing from core into the browser bundle). */

export interface A2uiComponent {
  id: string;
  component: string;
  children?: string[] | { path: string; componentId: string };
  child?: string;
  [key: string]: unknown;
}

export interface CreateSurfaceMessage {
  version: 'v0.9';
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: Record<string, unknown>;
    sendDataModel?: boolean;
  };
}

export interface UpdateComponentsMessage {
  version: 'v0.9';
  updateComponents: {
    surfaceId: string;
    components: A2uiComponent[];
  };
}

export interface UpdateDataModelMessage {
  version: 'v0.9';
  updateDataModel: {
    surfaceId: string;
    path?: string;
    value?: unknown;
  };
}

export interface DeleteSurfaceMessage {
  version: 'v0.9';
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2uiMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

export interface SurfaceState {
  surfaceId: string;
  catalogId: string;
  components: Map<string, A2uiComponent>;
  dataModel: Record<string, unknown>;
  theme?: Record<string, unknown>;
  sendDataModel: boolean;
  /** Set when the latest envelope deleted this surface. */
  deleted?: boolean;
}

export interface ActionPayload {
  surfaceId: string;
  name: string;
  context: Record<string, unknown>;
  dataModel?: Record<string, unknown>;
}
