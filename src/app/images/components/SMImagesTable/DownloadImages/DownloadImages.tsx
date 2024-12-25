import React, { useCallback, useEffect, useState } from "react";

import type { MultiSelectItem } from "@canonical/react-components";
import { MultiSelect, Form, Strip } from "@canonical/react-components";
import { Field } from "formik";
import { useDispatch, useSelector } from "react-redux";

import FormikForm from "@/app/base/components/FormikForm";
import { useSidePanel } from "@/app/base/side-panel-context";
import { bootResourceActions } from "@/app/store/bootresource";
import bootResourceSelectors from "@/app/store/bootresource/selectors";
import type {
  BootResource,
  BootResourceUbuntuArch,
  BootResourceUbuntuRelease,
} from "@/app/store/bootresource/types";
import {
  BootResourceSourceType,
  BootResourceAction,
} from "@/app/store/bootresource/types";

import "./_index.scss";

type GroupedImages = {
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
  os: string;
};

const getDownloadableImages = (
  releases: BootResourceUbuntuRelease[],
  architectures: BootResourceUbuntuArch[]
) => {
  return releases
    .map((image) => {
      return architectures.map((arch) => {
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
};

const getSyncedImages = (
  downloadableImages: DownloadableImage[],
  resources: BootResource[]
): Record<string, { label: string; value: string }[]> => {
  return downloadableImages
    .filter((image) => {
      return resources.some(
        (resource) =>
          resource.title === image.release &&
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

const getValueKey = (distro: string, release: string) =>
  `${distro}-${release}`.replace(".", "-");

const DownloadImages: React.FC = () => {
  const dispatch = useDispatch();
  const ubuntu = useSelector(bootResourceSelectors.ubuntu);
  const resources = useSelector(bootResourceSelectors.ubuntuResources);

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
    if (ubuntu) {
      const downloadableImages = getDownloadableImages(
        ubuntu.releases,
        ubuntu.arches
      );
      const syncedImages = getSyncedImages(downloadableImages, resources);
      setSyncedImages(syncedImages);
      const imagesByOS = groupImagesByOS(downloadableImages);
      setGroupedImages(groupArchesByRelease(imagesByOS));
    }
  }, [ubuntu, resources]);

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
          const osystems = Object.entries(
            values as Record<string, { label: string; value: string }[]>
          ).map(([key, images]) => {
            const [osystem] = key.split("-", 1);
            const arches = images.map((image) => image.label);
            const release = images[0].value.split("-")[1];
            return {
              arches,
              osystem: osystem.toLowerCase(),
              release,
            };
          });
          const params = mainSource
            ? {
                osystems,
                ...mainSource,
              }
            : {
                osystems,
                source_type: BootResourceSourceType.MAAS_IO,
              };
          dispatch(bootResourceActions.saveUbuntu(params));
          resetForm();
        }}
        onSuccess={() => {
          dispatch(bootResourceActions.poll({ continuous: false }));
        }}
        submitLabel={"Download"}
      >
        {({ values, setFieldValue }: { values: any; setFieldValue: any }) => (
          <Form>
            {Object.keys(groupedImages).map((distro) => (
              <span key={distro}>
                <h2 className="p-heading--4">{distro} images</h2>
                <table className="download-images-table">
                  <thead>
                    <tr>
                      <th>Release</th>
                      <th>Architecture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(groupedImages[distro]).map((release) => (
                      <tr aria-label={release} key={release}>
                        <td>{release}</td>
                        <td>
                          <Field
                            as={MultiSelect}
                            items={groupedImages[distro][release]}
                            name={`${distro}-${release}`}
                            onItemsUpdate={(items: MultiSelectItem) =>
                              setFieldValue(getValueKey(distro, release), items)
                            }
                            placeholder="Select architectures"
                            selectedItems={values[getValueKey(distro, release)]}
                            variant="condensed"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </span>
            ))}
          </Form>
        )}
      </FormikForm>
    </Strip>
  );
};

export default DownloadImages;
