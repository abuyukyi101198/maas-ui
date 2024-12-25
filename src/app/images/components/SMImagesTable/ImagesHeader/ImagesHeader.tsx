import React, { useEffect } from "react";

import { Button, Icon, Tooltip } from "@canonical/react-components";
import { useSelector } from "react-redux";

import { useSidePanel } from "@/app/base/side-panel-context";
import { ImageSidePanelViews } from "@/app/images/constants";
import { Labels } from "@/app/images/views/ImageList/SyncedImages/SyncedImages";
import bootResourceSelectors from "@/app/store/bootresource/selectors";
import type { BootResourceUbuntuSource } from "@/app/store/bootresource/types";
import { BootResourceSourceType } from "@/app/store/bootresource/types";

const getImageSyncText = (sources: BootResourceUbuntuSource[]) => {
  if (sources.length === 1) {
    const mainSource = sources[0];
    if (mainSource.source_type === BootResourceSourceType.MAAS_IO) {
      return "maas.io";
    }
    return mainSource.url;
  }
  return "sources";
};

const ImagesHeader: React.FC = () => {
  const ubuntu = useSelector(bootResourceSelectors.ubuntu);
  const resources = useSelector(bootResourceSelectors.resources);
  const { setSidePanelContent } = useSidePanel();
  const sources = ubuntu?.sources || [];
  const hasSources = sources.length !== 0;

  useEffect(() => {
    if (!hasSources) {
      setSidePanelContent({
        view: ImageSidePanelViews.CHANGE_SOURCE,
        extras: { hasSources },
      });
    }
  }, [hasSources, setSidePanelContent]);

  const canChangeSource = resources.every((resource) => !resource.downloading);
  return (
    <div>
      <div className="u-flex--between">
        <h4 data-testid="image-sync-text">
          {Labels.SyncedFrom} <strong>{getImageSyncText(sources)}</strong>
        </h4>
        <div>
          <Button
            onClick={() =>
              setSidePanelContent({
                view: ImageSidePanelViews.DOWNLOAD_IMAGE,
              })
            }
            type="button"
          >
            Download images
          </Button>
          <Button
            data-testid="change-source-button"
            disabled={!canChangeSource}
            onClick={() =>
              setSidePanelContent({
                view: ImageSidePanelViews.CHANGE_SOURCE,
                extras: { hasSources },
              })
            }
          >
            {Labels.ChangeSource}
            {!canChangeSource && (
              <Tooltip
                className="u-nudge-right--small"
                message="Cannot change source while images are downloading."
                position="top-right"
              >
                <Icon name="information" />
              </Tooltip>
            )}
          </Button>
        </div>
      </div>
      <p>
        Select images to be imported and kept in sync daily. Images will be
        available for deploying to machines managed by MAAS.
      </p>
      <hr />
    </div>
  );
};

export default ImagesHeader;
