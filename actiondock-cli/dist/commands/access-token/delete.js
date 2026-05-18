import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class AccessTokenDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock access token";
    static args = {
        tokenId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(AccessTokenDeleteCommand);
        try {
            await createClient(flags).deleteAccessToken(args.tokenId);
            flags.json ? this.printJson({ deleted: true, id: args.tokenId }) : this.log(`访问令牌已删除: ${args.tokenId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
