package org.team4u.scriptflow.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 脚本定义 JPA 实体，对应 script_definition 表。
 * <p>
 * 包含脚本草稿内容和已发布快照的平铺字段。
 *
 * @author jay.wu
 */
@Entity
@Table(name = "script_definition")
public class ScriptEntity {
    @Id
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String type;

    @Lob
    @Column(nullable = false)
    private String source;

    @Lob
    private String inputSchemaJson;

    @Lob
    private String outputSchemaJson;

    private String publishedName;

    private String publishedType;

    @Lob
    private String publishedSource;

    @Lob
    private String publishedInputSchemaJson;

    @Lob
    private String publishedOutputSchemaJson;

    private String status;
    private Integer versionValue;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getInputSchemaJson() { return inputSchemaJson; }
    public void setInputSchemaJson(String inputSchemaJson) { this.inputSchemaJson = inputSchemaJson; }
    public String getOutputSchemaJson() { return outputSchemaJson; }
    public void setOutputSchemaJson(String outputSchemaJson) { this.outputSchemaJson = outputSchemaJson; }
    public String getPublishedName() { return publishedName; }
    public void setPublishedName(String publishedName) { this.publishedName = publishedName; }
    public String getPublishedType() { return publishedType; }
    public void setPublishedType(String publishedType) { this.publishedType = publishedType; }
    public String getPublishedSource() { return publishedSource; }
    public void setPublishedSource(String publishedSource) { this.publishedSource = publishedSource; }
    public String getPublishedInputSchemaJson() { return publishedInputSchemaJson; }
    public void setPublishedInputSchemaJson(String publishedInputSchemaJson) { this.publishedInputSchemaJson = publishedInputSchemaJson; }
    public String getPublishedOutputSchemaJson() { return publishedOutputSchemaJson; }
    public void setPublishedOutputSchemaJson(String publishedOutputSchemaJson) { this.publishedOutputSchemaJson = publishedOutputSchemaJson; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getVersionValue() { return versionValue; }
    public void setVersionValue(Integer versionValue) { this.versionValue = versionValue; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
