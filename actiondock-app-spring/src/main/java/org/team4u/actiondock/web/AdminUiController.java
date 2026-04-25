package org.team4u.actiondock.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 管理后台 UI 控制器，将前端路由统一转发到静态资源。
 *
 * @author jay.wu
 */
@Controller
public class AdminUiController {
    /**
     * 管理后台首页路由。
     * <p>
     * 将所有管理后台前端路由统一转发到静态 index.html，由前端路由处理页面跳转。
     *
     * @return 转发到 admin/index.html
     */
    @GetMapping({
            "/admin",
            "/admin/",
            "/admin/scripts",
            "/admin/plugins",
            "/admin/scripts/new",
            "/admin/scripts/{id:[A-Za-z0-9_-]+}",
            "/admin/run/{id:[A-Za-z0-9_-]+}"
    })
    public String index() {
        return "forward:/admin/index.html";
    }
}
