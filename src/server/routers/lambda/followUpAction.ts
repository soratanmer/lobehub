import { FollowUpExtractInputSchema } from '@lobechat/types';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FollowUpActionService } from '@/server/services/followUpAction';

const followUpProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      followUpService: new FollowUpActionService(ctx.serverDB, ctx.userId),
    },
  });
});
const followUpWriteProcedure = followUpProcedure.use(withScopedPermission('message:create'));

export const followUpActionRouter = router({
  extract: followUpWriteProcedure
    .input(FollowUpExtractInputSchema)
    .mutation(async ({ input, ctx }) => ctx.followUpService.extract(input)),
});
