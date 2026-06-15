import { z } from "zod";

/** Discord interaction request types (subset we handle). */
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

/** Discord interaction callback (response) types (subset we send). */
export const InteractionCallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  /** Open the app's Activity in the user's current voice channel. */
  LAUNCH_ACTIVITY: 12,
} as const;

/** The slash command that launches the Activity. */
export const COMMAND_NAME = "agricola";

const interactionSchema = z.object({
  type: z.number(),
  data: z.object({ name: z.string() }).partial().optional(),
});

export type InteractionResponse =
  | { type: typeof InteractionCallbackType.PONG }
  | { type: typeof InteractionCallbackType.LAUNCH_ACTIVITY }
  | {
      type: typeof InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE;
      data: { content: string; flags?: number };
    };

/** Ephemeral message flag — only the invoking user sees it. */
const EPHEMERAL = 1 << 6;

/** Route a (already signature-verified) interaction body to a response.
 *  Pure and synchronous so it is trivially testable. */
export function handleInteraction(body: unknown): InteractionResponse {
  const interaction = interactionSchema.parse(body);
  if (interaction.type === InteractionType.PING) {
    return { type: InteractionCallbackType.PONG };
  }
  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === COMMAND_NAME
  ) {
    return { type: InteractionCallbackType.LAUNCH_ACTIVITY };
  }
  return {
    type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `Unknown command. Try \`/${COMMAND_NAME}\`.`, flags: EPHEMERAL },
  };
}
