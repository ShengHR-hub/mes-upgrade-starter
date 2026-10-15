import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { REQUIRED_ROLES } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { DailyReportsController } from './daily-reports.controller.js';

describe('DailyReportsController (契约 §5.2 第 14 行 / §7.2 F2)', () => {
  const reflector = new Reflector();

  it('控制器元数据：配置 AuthGuard 与 RolesGuard，严格仅允许 admin 角色', () => {
    const guards = Reflect.getMetadata('__guards__', DailyReportsController);
    expect(guards).toBeDefined();
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);

    const requiredRoles = reflector.get(REQUIRED_ROLES, DailyReportsController);
    expect(requiredRoles).toEqual(['admin']);
  });

  it('admin 允许访问，manager 与 operator 角色被拒绝（抛 20004 FORBIDDEN）', () => {
    const rolesGuard = new RolesGuard(reflector);

    const adminContext = {
      getHandler: () => DailyReportsController.prototype.generate,
      getClass: () => DailyReportsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: '1', role: 'admin', username: 'admin' },
        }),
      }),
    } as any;

    expect(rolesGuard.canActivate(adminContext)).toBe(true);

    for (const role of ['manager', 'operator'] as const) {
      const nonAdminContext = {
        getHandler: () => DailyReportsController.prototype.generate,
        getClass: () => DailyReportsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: '2', role, username: 'user' },
          }),
        }),
      } as any;

      expect(() => rolesGuard.canActivate(nonAdminContext)).toThrowError(/无权限操作/);
    }
  });

  it('POST 接口正确调用 DailyReportsService', async () => {
    const mockService = {
      generateDailyReport: vi.fn(async () => ({ date: '2026-10-09' })),
    };

    const controller = new DailyReportsController(mockService as any);
    const user = { id: '1', role: 'admin', username: 'admin' } as any;

    await controller.generate({ date: '2026-10-09' }, user);
    expect(mockService.generateDailyReport).toHaveBeenCalledWith(
      { date: '2026-10-09' },
      user,
    );
  });
});
