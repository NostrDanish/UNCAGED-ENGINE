import { useMutation } from "@tanstack/react-query";
import { BlossomUploader } from '@nostrify/nostrify/uploaders';

import { useCurrentUser } from "./useCurrentUser";

/**
 * Default Blossom media servers, used for avatar uploads during signup.
 * Swap these for your own servers if you self-host media.
 */
const DEFAULT_BLOSSOM_SERVERS = [
  'https://blossom.ditto.pub/',
  'https://blossom.primal.net/',
];

export function useUploadFile() {
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user) {
        throw new Error('Must be logged in to upload files');
      }

      const uploader = new BlossomUploader({
        servers: DEFAULT_BLOSSOM_SERVERS,
        signer: user.signer,
      });

      const tags = await uploader.upload(file);
      return tags;
    },
  });
}
