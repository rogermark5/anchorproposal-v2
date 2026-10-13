import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GenerationsService } from './generations.service';
import { GenerationsController } from './generations.controller';
import { PublicResumeController } from './public-resume.controller';
import { GenerationProcessor } from './generation.processor';
import { AnswersService } from './answers.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { RulesModule } from '../rules/rules.module';
import { SettingsModule } from '../settings/settings.module';
import { DeepseekService } from '../deepseek/deepseek.service';
import { DocumentRendererService } from '../documents/document-renderer.service';
import { TemplatesModule } from '../templates/templates.module';
import { StorageService } from '../storage/storage.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get('REDIS_URL') || 'redis://localhost:6379' },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: 'resume-generation' }),
    ProfilesModule,
    RulesModule,
    SettingsModule,
    TemplatesModule,
  ],
  controllers: [GenerationsController, PublicResumeController],
  providers: [
    GenerationsService,
    AnswersService,
    GenerationProcessor,
    DeepseekService,
    DocumentRendererService,
    StorageService,
  ],
  exports: [GenerationsService],
})
export class GenerationsModule {}
