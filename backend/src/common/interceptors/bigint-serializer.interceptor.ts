import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { serializeBigInt } from '../utils/bigint.util.js';

/**
 * BIGINT 出口序列化拦截器。
 *
 * 把 handler 返回值中的 `bigint` 递归转为十进制字符串，保证
 * `{"id": 101n}` → `{"id": "101"}`，符合契约 §2.1 对 BIGINT ID 的要求。
 *
 * 注册顺序：本拦截器在内层（先于 TransformInterceptor 执行 map），
 * 这样统一包体本身也会被完整遍历一遍。
 */
@Injectable()
export class BigIntSerializerInterceptor<T> implements NestInterceptor<T, T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<T> {
    return next.handle().pipe(map((data) => serializeBigInt(data)));
  }
}
