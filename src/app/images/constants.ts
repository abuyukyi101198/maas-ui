export const ImageNonActionHeaderViews = {
  CHANGE_SOURCE: ["imageNonActionForm", "changeSource"],
  DELETE_IMAGE: ["imageNonActionForm", "deleteImage"],
  DOWNLOAD_IMAGE: ["imageNonActionForm", "downloadImage"],
} as const;

export const ImageSidePanelViews = {
  ...ImageNonActionHeaderViews,
} as const;
