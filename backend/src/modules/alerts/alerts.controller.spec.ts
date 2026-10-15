import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { REQUIRED_ROLES } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { AlertsController } from './alerts.controller.js';

describe('AlertsController (契约 §5.2 第 16 行 / §6.9 B10)', () => {
  const reflector = new Reflector();

  it('控制器元数据：配置 AuthGuard 与 RolesGuard，仅允许 admin / manager 角色', () => {
    const guards = Reflect.getMetadata('__guards__', AlertsController);
    expect(guards).toBeDefined();
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);

    const requiredRoles = reflector.get(REQUIRED_ROLES, AlertsController);
    expect(requiredRoles).toEqual(['admin', 'manager']);
  });

  it('admin 与 manager 允许访问，operator 角色被拒绝（抛 20004 FORBIDDEN）', () => {
    const rolesGuard = new RolesGuard(reflector);

    for (const role of ['admin', 'manager'] as const) {
      const mockContext = {
        getHandler: () => AlertsController.prototype.list,
        getClass: () => AlertsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: '1', role, username: 'test' },
          }),
        }),
      } as any;

      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    }

    const opContext = {
      getHandler: () => AlertsController.prototype.list,
      getClass: () => AlertsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: '2', role: 'operator', username: 'op' },
        }),
      }),
    } as any;

    expect(() => rolesGuard.canActivate(opContext)).toThrowError(/无权限操作/);
  });

  it('GET 接口与状态流转接口正确调用 AlertsService', async () => {
    const mockService = {
      list: vi.fn(async () => ({ list: [], total: 0 })),
      getById: vi.fn(async () => ({ id: '801' })),
      transitionState: vi.fn(async () => ({ id: '801', status: '已确认' })),
    };

    const controller = new AlertsController(mockService as any);

    await controller.list({ page: 1, pageSize: 20 });
    expect(mockService.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });

    await controller.getById('801');
    expect(mockService.getById).toHaveBeenCalledWith('801');

    const user = { id: '1', role: 'admin', username: 'admin' } as any;
    const req = { ip: '127.0.0.1' } as any;
    const dto = { expectedStatus: '未处理', targetStatus: '已确认' };

    await controller.transitionState('801', dto, user, req);
    expect(mockService.transitionState).toHaveBeenCalledWith('801', dto, {
      userId: '1',
      ip: '127.0.0.1',
    });
  });

  it('POST /alerts/:id/root-cause-analyses 仅允许 admin，manager 与 operator 严格拒绝（抛 20004 FORBIDDEN）', async () => {
    const rolesGuard = new RolesGuard(reflector);

    const adminContext = {
      getHandler: () => AlertsController.prototype.analyzeRootCause,
      getClass: () => AlertsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: '1', role: 'admin', username: 'admin' },
        }),
      }),
    } as any;

    expect(rolesGuard.canActivate(adminContext)).toBe(true);

    for (const role of ['manager', 'operator'] as const) {
      const nonAdminContext = {
        getHandler: () => AlertsController.prototype.analyzeRootCause,
        getClass: () => AlertsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: '2', role, username: 'user' },
          }),
        }),
      } as any;

      expect(() => rolesGuard.canActivate(nonAdminContext)).toThrowError(/无权限操作/);
    }

    const mockService = {
      analyzeRootCause: vi.fn(async () => ({ alertId: '801' })),
    };
    const controller = new AlertsController(mockService as any);
    const user = { id: '1', role: 'admin', username: 'admin' } as any;

    await controller.analyzeRootCause('801', user);
    expect(mockService.analyzeRootCause).toHaveBeenCalledWith('801', user);
  });
});
