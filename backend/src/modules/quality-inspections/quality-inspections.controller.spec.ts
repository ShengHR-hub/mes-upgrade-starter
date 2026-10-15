import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../common/auth/auth.guard.js';
import { REQUIRED_ROLES } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { DefectsController } from './defects.controller.js';
import { QualityInspectionsController } from './quality-inspections.controller.js';

describe('QualityInspectionsController & DefectsController —— 契约 §5.2 / §6.5', () => {
  const reflector = new Reflector();

  it('控制器元数据：配置 AuthGuard 与 RolesGuard，三角色均允许', () => {
    for (const ctrl of [QualityInspectionsController, DefectsController]) {
      const guards = Reflect.getMetadata('__guards__', ctrl);
      expect(guards).toBeDefined();
      expect(guards).toContain(AuthGuard);
      expect(guards).toContain(RolesGuard);

      const requiredRoles = reflector.get(REQUIRED_ROLES, ctrl);
      expect(requiredRoles).toEqual(['admin', 'manager', 'operator']);
    }
  });

  it('三角色（admin / manager / operator）均能通过 RolesGuard 校验', () => {
    const rolesGuard = new RolesGuard(reflector);

    for (const role of ['admin', 'manager', 'operator'] as const) {
      const mockContext = {
        getHandler: () => QualityInspectionsController.prototype.create,
        getClass: () => QualityInspectionsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: '3', role, username: 'inspector' },
          }),
        }),
      } as any;

      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    }
  });

  it('匿名访问或缺少身份被 RolesGuard 拒绝（抛 20001 UNAUTHENTICATED）', () => {
    const rolesGuard = new RolesGuard(reflector);

    const mockContext = {
      getHandler: () => QualityInspectionsController.prototype.create,
      getClass: () => QualityInspectionsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: null }),
      }),
    } as any;

    expect(() => rolesGuard.canActivate(mockContext)).toThrowError();
  });

  it('QualityInspectionsController 调用服务并绑定当前用户', async () => {
    const mockService = {
      list: vi.fn(async () => ({ list: [], total: 0, page: 1, pageSize: 20 })),
      findOne: vi.fn(async () => ({ id: '501' })),
      create: vi.fn(async () => ({ id: '501' })),
      listDefects: vi.fn(async () => ({ list: [], total: 0, page: 1, pageSize: 20 })),
    };

    const qcCtrl = new QualityInspectionsController(mockService as any);
    const defectCtrl = new DefectsController(mockService as any);

    await qcCtrl.list({ page: '1' } as any);
    expect(mockService.list).toHaveBeenCalledWith({ page: '1' });

    await qcCtrl.findOne('501');
    expect(mockService.findOne).toHaveBeenCalledWith('501');

    const user = { id: '3', role: 'operator', username: 'qc' } as any;
    const req = { ip: '127.0.0.1' } as any;
    const dto = { workOrderId: '201', result: 'OK' as const, checkQty: 10, ngQty: 0 };

    await qcCtrl.create(dto, user, req);
    expect(mockService.create).toHaveBeenCalledWith(dto, {
      userId: '3',
      ip: '127.0.0.1',
    });

    await defectCtrl.list({ defectType: '虚焊' } as any);
    expect(mockService.listDefects).toHaveBeenCalledWith({ defectType: '虚焊' });
  });
});
