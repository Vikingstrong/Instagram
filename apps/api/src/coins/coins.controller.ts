import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  CoinClaimResponseSchema,
  CoinTransactionsResponseSchema,
  CoinWalletResponseSchema,
  EmptyRequestSchema,
  PageQuerySchema,
} from '@instagram/contracts';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/auth-session.guard.js';
import { AuthRateLimiter } from '../auth/auth-rate-limiter.js';
import {
  errorResponse,
  mutationBody,
  noStore,
  parse,
  schema,
} from '../auth/auth-http.js';
import { CoinsService } from './coins.service.js';
const ok = (value: Parameters<typeof schema>[0]) =>
  ApiResponse({ status: 200, headers: noStore, schema: schema(value) });

@ApiTags('Coins')
@ApiSecurity('session')
@Controller('coins')
@UseGuards(SessionGuard)
@errorResponse(400)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class CoinsController {
  constructor(
    @Inject(CoinsService) private readonly coins: CoinsService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  private reader(req: AuthenticatedRequest) {
    this.limiter.consume('coins-read', req.authUser!.id, 300, 300_000);
    return req.authUser!.id;
  }
  @Get('wallet')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'getCoinWallet',
    summary:
      'Own balance and daily bonus availability; decimal strings, Asia/Dushanbe midnight',
  })
  @ok(CoinWalletResponseSchema)
  async wallet(@Req() req: AuthenticatedRequest) {
    return CoinWalletResponseSchema.parse({
      wallet: await this.coins.wallet(this.reader(req)),
    });
  }
  @Post('daily-claim')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiOperation({
    operationId: 'claimDailyCoins',
    summary:
      'Manually receive 100 coins once per Dushanbe date; retry returns credited=false without another reward',
  })
  @ok(CoinClaimResponseSchema)
  @errorResponse(409)
  async claim(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    parse(body, EmptyRequestSchema);
    this.limiter.consume('coins-claim', req.authUser!.id, 30, 300_000);
    return CoinClaimResponseSchema.parse(
      await this.coins.claim(req.authUser!.id),
    );
  }
  @Get('transactions')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    operationId: 'listCoinTransactions',
    summary:
      'Own reward and gift history, newest first; balanceAfter is historical, not current balance',
  })
  @ok(CoinTransactionsResponseSchema)
  async transactions(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
  ) {
    return CoinTransactionsResponseSchema.parse(
      await this.coins.transactions(
        this.reader(req),
        parse(query, PageQuerySchema),
      ),
    );
  }
}
