import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    const supplied = req.headers['x-request-id'];
    req.requestId = typeof supplied === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(supplied) ? supplied : uuidv4();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}
