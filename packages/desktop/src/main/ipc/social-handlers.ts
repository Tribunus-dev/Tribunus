/**
 * IPC handlers for dharma social network operations.
 *
 * Each handler is a stub — actual P2P integration comes later.
 * - Get operations return null (not found) or empty arrays.
 * - Mutation operations log and return void.
 */

import { IPC } from "../ipc-channels"
import { withIpcResult } from "../ipc-contract"
import { registerIpcHandler } from "../ipc-registration"
import type {
  SocialProfileParams,
  SocialProfileUpdateParams,
  SocialFollowParams,
  SocialUnfollowParams,
  SocialGetFeedParams,
  SocialEndorseParams,
  SocialBlockParams,
  SocialUnblockParams,
  SocialGetEndorsementsParams,
  SocialGetScoreParams,
} from "../ipc-contract"
import type {
  SocialProfile,
  SocialProfileUpdate,
  FollowRecord,
  FeedItem,
  Endorsement,
  BlockEntry,
  DharmaSocialScore,
} from "@tribunus/runtime/tribunus/dharma/codex/codex-social"

export function registerSocialIpcHandlers(): void {
  registerIpcHandler(IPC.handle.SOCIAL_GET_PROFILE, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getProfile", async () => {
      console.log("[social] getProfile stub", params.identityId)
      return null as SocialProfile | null
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_UPDATE_PROFILE, async (_event, params: SocialProfileUpdateParams) => {
    return withIpcResult("social.updateProfile", async () => {
      console.log("[social] updateProfile stub", params.identityId, params.displayName, params.bio, params.website)
      // Stub: return a stub profile as if saved; real impl will persist and return the actual profile
      return {
        profileId: params.identityId,
        displayName: params.displayName ?? "",
        bio: params.bio ?? "",
        avatarHash: null,
        website: params.website ?? "",
        joinedAt: new Date().toISOString(),
        profileVersion: 1,
      } as SocialProfile
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_FOLLOW, async (_event, params: SocialFollowParams) => {
    return withIpcResult("social.follow", async () => {
      console.log("[social] follow stub", params.followerId, "->", params.followeeId)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_UNFOLLOW, async (_event, params: SocialUnfollowParams) => {
    return withIpcResult("social.unfollow", async () => {
      console.log("[social] unfollow stub", params.followerId, "->", params.followeeId)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_FOLLOWERS, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getFollowers", async () => {
      console.log("[social] getFollowers stub", params.identityId)
      return [] as FollowRecord[]
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_FOLLOWING, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getFollowing", async () => {
      console.log("[social] getFollowing stub", params.identityId)
      return [] as FollowRecord[]
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_FEED, async (_event, params: SocialGetFeedParams) => {
    return withIpcResult("social.getFeed", async () => {
      console.log("[social] getFeed stub", params.identityId, `limit=${params.limit}`, `offset=${params.offset}`)
      return [] as FeedItem[]
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_ENDORSE, async (_event, params: SocialEndorseParams) => {
    return withIpcResult("social.endorse", async () => {
      console.log("[social] endorse stub", params.fromId, "->", params.toId, "for", params.forContributionId)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_ENDORSEMENTS, async (_event, params: SocialGetEndorsementsParams) => {
    return withIpcResult("social.getEndorsements", async () => {
      console.log("[social] getEndorsements stub", params.identityId)
      return [] as Endorsement[]
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_BLOCKED, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getBlocked", async () => {
      console.log("[social] getBlocked stub", params.identityId)
      return [] as BlockEntry[]
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_BLOCK_USER, async (_event, params: SocialBlockParams) => {
    return withIpcResult("social.blockUser", async () => {
      console.log("[social] blockUser stub", params.blockerId, "->", params.blockedId, params.reason)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_UNBLOCK_USER, async (_event, params: SocialUnblockParams) => {
    return withIpcResult("social.unblockUser", async () => {
      console.log("[social] unblockUser stub", params.blockerId, "->", params.blockedId)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_SCORE, async (_event, params: SocialGetScoreParams) => {
    return withIpcResult("social.getScore", async () => {
      console.log("[social] getScore stub", params.identityId)
      return null as DharmaSocialScore | null
    })
  })
}
