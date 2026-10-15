import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { REQUIRED_ROLES } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { DataQueriesController } from './data-queries.controller.js';

describe('DataQueriesController (契约 §5.2 第 18 行 / §7.1 F3)', () => {
  const reflector = new Reflector();

  it('控制器元数据：配置 AuthGuard 与 RolesGuard，仅允许 admin / manager', () => {
    const guards = Reflect.getMetadata('__guards__', DataQueriesController);
    expect(guards).toBeDefined();
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);

    const requiredRoles = reflector.get(REQUIRED_ROLES, DataQueriesController);
    expect(requiredRoles).toEqual(['admin', 'manager']);
  });

  it('operator 角色被 RolesGuard 拒绝（抛 20004 FORBIDDEN）', () => {
    const rolesGuard = new RolesGuard(reflector);

    for (const role of ['admin', 'manager'] as const) {
      const allowedContext = {
        getHandler: () => DataQueriesController.prototype.query,
        getClass: () => DataQueriesController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: '1', role, username: 'user' } }),
        }),
      } as any;
      expect(rolesGuard.canActivate(allowedContext)).toBe(true);
    }

    const operatorContext = {
      getHandler: () => DataQueriesController.prototype.query,
      getClass: () => DataQueriesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: '3', role: 'operator', username: 'operator' } }),
      }),
    } as any;
    expect(() => rolesGuard.canActivate(operatorContext)).toThrowError(/无权限操作/);
  });

  it('POST 接口正确调用 DataQueriesService', async () => {
    const mockService = {
      queryData: vi.fn(async () => ({ answerStatus: 'answered' })),
    };

    const controller = new DataQueriesController(mockService as any);
    const user = { id: '1', role: 'admin', username: 'admin' } as any;
    const dto = { question: '今天哪条产线直通率最低？' };

    await controller.query(dto, user);
    expect(mockService.queryData).toHaveBeenCalledWith(dto, user);
  });
});
