import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { REQUIRED_ROLES } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ReportsController } from './reports.controller.js';

describe('ReportsController —— 契约 §5.2 / §6.4', () => {
  const reflector = new Reflector();

  it('控制器元数据：配置 AuthGuard 与 RolesGuard，三角色均允许', () => {
    const guards = Reflect.getMetadata('__guards__', ReportsController);
    expect(guards).toBeDefined();
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);

    const requiredRoles = reflector.get(REQUIRED_ROLES, ReportsController);
    expect(requiredRoles).toEqual(['admin', 'manager', 'operator']);
  });

  it('三角色（admin / manager / operator）均能通过 RolesGuard 校验', () => {
    const rolesGuard = new RolesGuard(reflector);

    for (const role of ['admin', 'manager', 'operator'] as const) {
      const mockContext = {
        getHandler: () => ReportsController.prototype.create,
        getClass: () => ReportsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: '1', role, username: 'test' },
          }),
        }),
      } as any;

      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    }
  });

  it('匿名访问或缺少身份被 RolesGuard 拒绝（抛 20001 UNAUTHENTICATED）', () => {
    const rolesGuard = new RolesGuard(reflector);

    const mockContext = {
      getHandler: () => ReportsController.prototype.create,
      getClass: () => ReportsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: null }),
      }),
    } as any;

    expect(() => rolesGuard.canActivate(mockContext)).toThrowError();
  });

  it('create 与 list 方法正确调用 ReportsService 并透传 CurrentUser', async () => {
    const mockService = {
      list: vi.fn(async () => ({ list: [], total: 0, page: 1, pageSize: 20 })),
      create: vi.fn(async () => ({ report: { id: '401' } })),
    };

    const controller = new ReportsController(mockService as any);

    await controller.list({ page: '1', pageSize: '20' } as any);
    expect(mockService.list).toHaveBeenCalledWith({ page: '1', pageSize: '20' });

    const user = { id: '2', role: 'operator', username: 'op' } as any;
    const req = { ip: '127.0.0.1' } as any;
    const dto = { taskId: '301', goodQty: 10, badQty: 0 };

    await controller.create(dto, user, req);
    expect(mockService.create).toHaveBeenCalledWith(dto, {
      userId: '2',
      ip: '127.0.0.1',
    });
  });
});
