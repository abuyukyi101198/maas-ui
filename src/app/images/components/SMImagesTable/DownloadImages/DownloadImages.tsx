import React, { useCallback, useEffect, useState } from "react";

import type { MultiSelectItem } from "@canonical/react-components";
import { Strip } from "@canonical/react-components";
import { useDispatch, useSelector } from "react-redux";

import DownloadImagesSelect from "./DownloadImagesSelect";

import FormikForm from "@/app/base/components/FormikForm";
import { useSidePanel } from "@/app/base/side-panel-context";
import { bootResourceActions } from "@/app/store/bootresource";
import bootResourceSelectors from "@/app/store/bootresource/selectors";
import type {
  BaseImageFields,
  BootResource,
  BootResourceUbuntuArch,
  BootResourceUbuntuRelease,
} from "@/app/store/bootresource/types";
import {
  BootResourceSourceType,
  BootResourceAction,
} from "@/app/store/bootresource/types";

import "./_index.scss";

export type GroupedImages = {
  [key: string]: ReleasesWithArches;
};

type ReleasesWithArches = {
  [key: string]: MultiSelectItem[];
};

type ImagesByOS = { [key: string]: DownloadableImage[] };

type DownloadableImage = {
  id: string;
  name: string;
  release: string;
  architectures: string;
  subArchitectures?: string;
  os: string;
};

const getDownloadableImages = (
  ubuntuReleases: BootResourceUbuntuRelease[],
  ubuntuArches: BootResourceUbuntuArch[],
  otherReleases: BaseImageFields[]
): DownloadableImage[] => {
  const ubuntuImages = ubuntuReleases
    .map((image) => {
      return ubuntuArches.map((arch) => {
        return {
          id: `ubuntu-${image.name}-${image.title}-${arch.name}`,
          name: image.name,
          release: image.title,
          architectures: arch.name,
          os: "Ubuntu",
        };
      });
    })
    .flat();

  const otherImages = otherReleases
    .map((image) => {
      const [os, architecture, subArchitecture, release] =
        image.name.split("/");
      return {
        id: `${os}-${release}-${architecture}-${subArchitecture}`,
        name: image.title,
        release: release,
        architectures: architecture,
        subArchitecture: subArchitecture,
        os: os.charAt(0).toUpperCase() + os.slice(1),
      };
    })
    .flat();

  return [...ubuntuImages, ...otherImages];
};

const getSyncedImages = (
  downloadableImages: DownloadableImage[],
  resources: BootResource[]
): Record<string, { label: string; value: string }[]> => {
  return downloadableImages
    .filter((image) => {
      return resources.some(
        (resource) =>
          (resource.title === image.release || resource.title === image.name) &&
          resource.arch === image.architectures
      );
    })
    .reduce<Record<string, { label: string; value: string }[]>>(
      (acc, image) => {
        const key = `${image.os}-${image.release.replace(".", "-")}`;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push({
          label: image.architectures,
          value: image.id,
        });
        return acc;
      },
      {}
    );
};

const groupImagesByOS = (images: DownloadableImage[]) => {
  let imagesByOS: ImagesByOS = {};

  images.forEach((image) => {
    if (!!imagesByOS[image.os]) {
      imagesByOS[image.os].push(image);
    } else {
      imagesByOS[image.os] = [image];
    }
  });

  Object.keys(imagesByOS).forEach((distro) => {
    imagesByOS[distro].sort((a, b) => {
      return b.release.localeCompare(a.release);
    });
  });

  return imagesByOS;
};

const groupArchesByRelease = (images: ImagesByOS) => {
  let groupedImages: GroupedImages = {};

  Object.keys(images).forEach((distro) => {
    if (!groupedImages[distro]) {
      groupedImages[distro] = {};
    }
    images[distro].forEach((image) => {
      if (!groupedImages[distro][image.release]) {
        groupedImages[distro][image.release] = [
          { label: image.architectures.toString(), value: image.id },
        ];
      } else {
        groupedImages[distro][image.release].push({
          label: image.architectures.toString(),
          value: image.id,
        });
      }
    });
  });

  return groupedImages;
};

const DownloadImages: React.FC = () => {
  const dispatch = useDispatch();
  const ubuntu = useSelector(bootResourceSelectors.ubuntu);
  const otherImages = useSelector(bootResourceSelectors.otherImages);
  const resources = useSelector(bootResourceSelectors.resources);

  const sources = ubuntu?.sources || [];
  const [groupedImages, setGroupedImages] = useState<GroupedImages>({});
  const [syncedImages, setSyncedImages] = useState({});

  const eventErrors = useSelector(bootResourceSelectors.eventErrors);
  const error = eventErrors.find(
    (error) =>
      error.event === BootResourceAction.SAVE_UBUNTU ||
      error.event === BootResourceAction.STOP_IMPORT
  )?.error;
  const cleanup = useCallback(() => bootResourceActions.cleanup(), []);

  const mainSource = sources.length > 0 ? sources[0] : null;
  const tooManySources = sources.length > 1;

  useEffect(() => {
    if (ubuntu && resources && otherImages) {
      const downloadableImages = getDownloadableImages(
        ubuntu.releases,
        ubuntu.arches,
        otherImages
      );
      setSyncedImages(getSyncedImages(downloadableImages, resources));
      const imagesByOS = groupImagesByOS(downloadableImages);
      setGroupedImages(groupArchesByRelease(imagesByOS));
    }
  }, [ubuntu, resources, otherImages]);

  useEffect(() => {
    return () => {
      dispatch(bootResourceActions.cleanup());
    };
  }, [dispatch]);

  const { setSidePanelContent } = useSidePanel();

  const resetForm = () => {
    setSidePanelContent(null);
  };

  return (
    <Strip shallow>
      <FormikForm
        allowUnchanged
        buttonsBehavior="independent"
        cleanup={cleanup}
        editable={!tooManySources}
        enableReinitialize
        errors={error}
        initialValues={syncedImages}
        onCancel={resetForm}
        onSubmit={(values) => {
          dispatch(cleanup());
          const ubuntuSystems: {
            arches: string[];
            osystem: string;
            release: string;
          }[] = [];
          const otherSystems: {
            arch: string;
            os: string;
            release: string;
            subArch: string;
          }[] = [];
          Object.entries(
            values as Record<string, { label: string; value: string }[]>
          ).forEach(([key, images]) => {
            const [osystem] = key.split("-", 1);

            if (osystem === "Ubuntu") {
              const arches = images.map((image) => image.label);
              const release = images[0].value.split("-")[1];
              ubuntuSystems.push({
                arches,
                osystem: osystem.toLowerCase(),
                release,
              });
            } else {
              const [os, release, arch, subArch] = images[0].value.split("-");
              otherSystems.push({
                arch,
                os,
                release,
                subArch,
              });
            }
          });

          if (ubuntuSystems.length > 0) {
            const params = mainSource
              ? {
                  osystems: ubuntuSystems,
                  ...mainSource,
                }
              : {
                  osystems: ubuntuSystems,
                  source_type: BootResourceSourceType.MAAS_IO,
                };
            dispatch(bootResourceActions.saveUbuntu(params));
          }

          if (otherSystems.length > 0) {
            const params = {
              images: otherSystems.map(
                ({ arch, os, release, subArch = "" }) =>
                  `${os}/${arch}/${subArch}/${release}`
              ),
            };
            dispatch(bootResourceActions.saveOther(params));
          }
          resetForm();
        }}
        onSuccess={() => {
          dispatch(bootResourceActions.poll({ continuous: false }));
        }}
        submitLabel={"Download"}
      >
        {({ values, setFieldValue }: { values: any; setFieldValue: any }) => (
          <DownloadImagesSelect
            groupedImages={groupedImages}
            setFieldValue={setFieldValue}
            values={values}
          />
        )}
      </FormikForm>
    </Strip>
  );
};

export default DownloadImages;
