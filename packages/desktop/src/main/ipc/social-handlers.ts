/**
 * IPC handlers for dharma social network operations.
 *
 * Each handler calls into the social bridge to access the
 * SocialReplicationManager singleton.
 */

import { IPC } from "../ipc-channels"
import { withIpcResult } from "../ipc-contract"
import { registerIpcHandler } from "../ipc-registration"
import { getSocialManager } from "@tribunus/runtime/tribunus/social-bridge"
import {
  sfwScreenPost,
  createPost,
  likePost,
  sharePost,
  createComment,
  createEndorsement,
  computeSocialScore,
} from "@tribunus/runtime/tribunus/dharma/codex/codex-social"
import type {
  FollowRecord,
  Endorsement,
  BlockEntry,
} from "@tribunus/runtime/tribunus/dharma/codex/codex-social"
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
  SocialCreatePostParams,
  SocialLikePostParams,
  SocialSharePostParams,
  SocialCommentParams,
  SocialCreatePostResult,
} from "../ipc-contract"

export function registerSocialIpcHandlers(): void {
  registerIpcHandler(IPC.handle.SOCIAL_GET_PROFILE, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getProfile", async () => {
      const mgr = getSocialManager()
      return mgr.getProfile()
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_UPDATE_PROFILE, async (_event, params: SocialProfileUpdateParams) => {
    return withIpcResult("social.updateProfile", async () => {
      const mgr = getSocialManager()
      return mgr.updateProfile(params)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_FOLLOW, async (_event, params: SocialFollowParams) => {
    return withIpcResult("social.follow", async () => {
      const mgr = getSocialManager()
      await mgr.follow(params.followeeId)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_UNFOLLOW, async (_event, params: SocialUnfollowParams) => {
    return withIpcResult("social.unfollow", async () => {
      const mgr = getSocialManager()
      await mgr.unfollow(params.followeeId)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_FOLLOWERS, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getFollowers", async () => {
      const mgr = getSocialManager()
      return mgr.getFollowers(params.identityId)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_FOLLOWING, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getFollowing", async () => {
      const mgr = getSocialManager()
      return mgr.getFollowing()
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_FEED, async (_event, params: SocialGetFeedParams) => {
    return withIpcResult("social.getFeed", async () => {
      const mgr = getSocialManager()
      return mgr.getFeed(params.limit ?? 50, params.offset ?? 0)
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_ENDORSE, async (_event, params: SocialEndorseParams) => {
    return withIpcResult("social.endorse", async () => {
      const mgr = getSocialManager()
      const endorsement = createEndorsement(params.fromId, params.toId, params.forContributionId, params.message)
      await mgr.appendActivity({
        type: "endorsed",
        data: {
          toId: endorsement.toId,
          contributionId: endorsement.forContributionId,
          message: endorsement.message,
        },
      })
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_ENDORSEMENTS, async (_event, params: SocialGetEndorsementsParams) => {
    return withIpcResult("social.getEndorsements", async () => {
      // Stub — no endorsement storage on manager yet
      return [] as Endorsement[]
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_GET_BLOCKED, async (_event, params: SocialProfileParams) => {
    return withIpcResult("social.getBlocked", async () => {
      // Stub — no block storage on manager yet
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
      const mgr = getSocialManager()
      const profile = await mgr.getProfile()
      const activities = await mgr.getActivities()
      const followRecords = await mgr.getFollowing()

      const score = computeSocialScore(
        params.identityId,
        0, // ledgerBalance — not exposed on manager yet
        [], // endorsements — not stored on manager yet
        followRecords,
        {
          proposalsAccepted: activities.filter((a) => a.type === "accepted_proposal").length,
          codexEntries: activities.filter((a) => a.type === "codex_entry").length,
        },
      )
      return score
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_CREATE_POST, async (_event, params: SocialCreatePostParams) => {
    return withIpcResult("social.createPost", async () => {
      const mgr = getSocialManager()

      // Screen content for SFW compliance
      const sfw = sfwScreenPost(params.content)
      if (sfw.verdict !== "pass") {
        return {
          ok: false,
          error: sfw.reason,
        } satisfies SocialCreatePostResult
      }

      const post = createPost(params.identityId, params.content, [], params.visibility ?? "public")

      await mgr.appendActivity({
        type: "codex_entry",
        data: {
          entryId: post.postId,
          title: post.content.slice(0, 80),
          knowledgeClass: "social_post",
        },
      })

      return {
        ok: true,
        postId: post.postId,
      } satisfies SocialCreatePostResult
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_LIKE_POST, async (_event, params: SocialLikePostParams) => {
    return withIpcResult("social.likePost", async () => {
      const mgr = getSocialManager()
      const like = likePost(params.userId, params.postId)
      await mgr.appendActivity({
        type: "codex_entry",
        data: {
          entryId: like.likeId,
          title: `liked post ${params.postId}`,
          knowledgeClass: "social_like",
        },
      })
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_SHARE_POST, async (_event, params: SocialSharePostParams) => {
    return withIpcResult("social.sharePost", async () => {
      const mgr = getSocialManager()
      const share = sharePost(params.userId, params.postId, params.message ?? "")
      await mgr.appendActivity({
        type: "codex_entry",
        data: {
          entryId: share.shareId,
          title: `shared post ${params.postId}`,
          knowledgeClass: "social_share",
        },
      })
    })
  })

  registerIpcHandler(IPC.handle.SOCIAL_COMMENT, async (_event, params: SocialCommentParams) => {
    return withIpcResult("social.comment", async () => {
      const mgr = getSocialManager()
      const comment = createComment(params.postId, params.authorId, params.content, params.parentCommentId ?? null)
      await mgr.appendActivity({
        type: "codex_entry",
        data: {
          entryId: comment.commentId,
          title: `comment on post ${params.postId}`,
          knowledgeClass: "social_comment",
        },
      })
    })
  })
}
