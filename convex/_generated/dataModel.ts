import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type Doc<TableName extends TableNamesInDataModel<DataModel>> = DocumentByName<DataModel, TableName>;
export type TableNames = TableNamesInDataModel<DataModel>;
export type Id<TableName extends TableNames> = GenericId<TableName>;
