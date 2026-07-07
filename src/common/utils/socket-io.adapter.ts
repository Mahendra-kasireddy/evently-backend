import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter wired to config (path + CORS origin).
 * Chat gateways bind to the /ws and /yjs namespaces.
 *
 * For multi-instance deployments, attach @socket.io/redis-adapter here
 * so rooms/broadcasts fan out across nodes via Redis.
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): any {
    const opts: Partial<ServerOptions> = {
      ...options,
      path: this.config.get<string>('socket.path', '/socket.io'),
      cors: {
        origin: this.config.get<string>('socket.corsOrigin', '*'),
        credentials: true,
      },
    };
    return super.createIOServer(port, opts as ServerOptions);
  }
}
