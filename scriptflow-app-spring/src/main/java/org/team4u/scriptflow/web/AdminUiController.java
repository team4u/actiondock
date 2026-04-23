package org.team4u.scriptflow.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 管理后台 UI 控制器，将前端路由统一转发到静态资源。
 *
 * @author jay.wu
 */
@Controller
public class AdminUiController {
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
