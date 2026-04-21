package org.team4u.scriptflow.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class AdminUiController {
    @GetMapping({
            "/admin",
            "/admin/",
            "/admin/scripts",
            "/admin/scripts/new",
            "/admin/scripts/{id:[A-Za-z0-9_-]+}",
            "/admin/run/{id:[A-Za-z0-9_-]+}"
    })
    public String index() {
        return "forward:/admin/index.html";
    }
}
