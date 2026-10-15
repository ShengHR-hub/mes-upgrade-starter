import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { REQUIRED_ROLES } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { DashboardsController } from './dashboards.controller.js';

describe('DashboardsController (契约 §5.2 第 15 行 / §6.8 B8)', () => {
  const reflector = new Reflector();

  it('控制器元数据：配置 AuthGuard 与 RolesGuard，仅允许 admin / manager 角色', () => {
    const guards = Reflect.getMetadata('__guards__', DashboardsController);
    expect(guards).toBeDefined();
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);

    const requiredRoles = reflector.get(REQUIRED_ROLES, DashboardsController);
    expect(requiredRoles).toEqual(['admin', 'manager']);
  });

  it('admin 与 manager 允许访问，operator 角色被拒绝（抛 20004 FORBIDDEN）', () => {
    const rolesGuard = new RolesGuard(reflector);

    for (const role of ['admin', 'manager'] as const) {
      const mockContext = {
        getHandler: () => DashboardsController.prototype.getProductionMetrics,
        getClass: () => DashboardsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: '1', role, username: 'test' },
          }),
        }),
      } as any;

      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    }

    const opContext = {
      getHandler: () => DashboardsController.prototype.getProductionMetrics,
      getClass: () => DashboardsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: '2', role: 'operator', username: 'op' },
        }),
      }),
    } as any;

    expect(() => rolesGuard.canActivate(opContext)).toThrowError(/无权限操作/);
  });

  it('匿名访问被 RolesGuard 拦截（抛 20001 UNAUTHENTICATED）', () => {
    const rolesGuard = new RolesGuard(reflector);

    const mockContext = {
      getHandler: () => DashboardsController.prototype.getProductionMetrics,
      getClass: () => DashboardsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: null }),
      }),
    } as any;

    expect(() => rolesGuard.canActivate(mockContext)).toThrowError(/未认证/);
  });

  it('各接口正确调用 MetricsAggregationService 并透传统一 snapshotAt', async () => {
    const mockService = {
      getProductionMetrics: vi.fn(async () => ({ metrics: {} })),
      getQualityMetrics: vi.fn(async () => ({ goodRate: 95 })),
      getDeviceMetrics: vi.fn(async () => ({ counts: {} })),
      getDeliveryMetrics: vi.fn(async () => ({ orderCount: 1 })),
    };

    const controller = new DashboardsController(mockService as any);

    await controller.getProductionMetrics({ startDate: '2026-10-09', endDate: '2026-10-09' });
    expect(mockService.getProductionMetrics).toHaveBeenCalledWith(
      { startDate: '2026-10-09', endDate: '2026-10-09' },
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    );

    await controller.getQualityMetrics({ startDate: '2026-10-09', endDate: '2026-10-09' });
    expect(mockService.getQualityMetrics).toHaveBeenCalled();

    await controller.getDeviceMetrics({});
    expect(mockService.getDeviceMetrics).toHaveBeenCalled();

    await controller.getDeliveryMetrics({ startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(mockService.getDeliveryMetrics).toHaveBeenCalled();
  });
});
