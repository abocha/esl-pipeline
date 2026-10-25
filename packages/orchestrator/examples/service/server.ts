import { createService } from './app.js';

const fastify = createService();

const port = Number(process.env.PORT ?? 8080);

const start = async () => {
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`service listening on ${port}`);
  } catch (error) {
    fastify.log.error({ err: error }, 'failed to start service');
    process.exitCode = 1;
  }
};

void start();
