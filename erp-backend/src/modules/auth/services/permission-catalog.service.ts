import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PermissionRequirement,
} from '@common/decorators/require-permissions.decorator';

export interface CatalogModule {
  module: string;
  screens: { screen: string; actions: string[] }[];
}

/**
 * Builds the list of every permission the API checks by scanning the
 * @RequirePermissions metadata of all controllers, so the role editor can
 * offer exactly the modules, screens and actions that exist.
 */
@Injectable()
export class PermissionCatalogService implements OnModuleInit {
  private catalog: CatalogModule[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const tree = new Map<string, Map<string, Set<string>>>();
    const add = (p: PermissionRequirement) => {
      const screens = tree.get(p.module) ?? new Map<string, Set<string>>();
      tree.set(p.module, screens);
      const screen = p.screen ?? '*';
      const actions = screens.get(screen) ?? new Set<string>();
      screens.set(screen, actions);
      actions.add(p.action ?? '*');
    };

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      (this.reflector.get<PermissionRequirement[]>(PERMISSIONS_KEY, metatype) ?? []).forEach(add);
      const prototype = Object.getPrototypeOf(instance);
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        (this.reflector.get<PermissionRequirement[]>(PERMISSIONS_KEY, prototype[name]) ?? []).forEach(
          add,
        );
      }
    }

    this.catalog = [...tree.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, screens]) => ({
        module,
        screens: [...screens.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([screen, actions]) => ({ screen, actions: [...actions].sort() })),
      }));
  }

  list(): CatalogModule[] {
    return this.catalog;
  }
}
