/** Build layout of the presentation skill payload carried beside the bundled runtime. */

/**
 * The two names are the contract between the Desktop build, which writes the
 * payload, and the Host composition, which mounts it. They live in their own
 * dependency-free module so the packaging script never loads a Cordis plugin.
 */

/** Payload directory carried beside the bundled runtime. */
export const PAYLOAD_DIRECTORY = 'ppt-skills'

/** Skill directory the payload must carry before the provider is mounted. */
export const SKILL_ENTRY = 'ppt-master'
